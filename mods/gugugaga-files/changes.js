// Herdr's shipped Changes panel (Herdr 0.1.16, Apache-2.0), plus:
//   - the diff wraps long lines (toggle in the header; on by default)
//   - right-click a changed file for a menu that opens it with the system
//     default app or reveals it in the file manager
// See actions.js and menu.js.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings } from "herdr";
import { openMenu, runAction, takeRun } from "./actions.js";

const MONO = "Cascadia Mono";
const ZOOM = () => (settings().zoom > 0 ? settings().zoom : 1);

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

// A wrapped row is drawn as fixed lines; 11px monospace is about 6.9px a
// column, and a CJK or emoji character takes two.
const LINE = 20, CHAR_PX = 6.9, GUTTER = 46;
const wide = (ch) => /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/u.test(ch) ? 2 : 1;

function splitColumns(text, cols) {
  const out = [];
  let line = "", used = 0;
  for (const ch of text) {
    const w = wide(ch);
    if (used + w > cols && line) { out.push(line); line = ""; used = 0; }
    line += ch; used += w;
  }
  out.push(line);
  return out;
}

const WRAP_KEY = "gugugaga-files/wrap";
const LEGACY_WRAP_KEY = "files-and-changes-addon/wrap";
// 首次读不到新 key 时回落读旧 key，老用户的开关状态不会丢。
const wrapPref = () => {
  try { return (localStorage.getItem(WRAP_KEY) ?? localStorage.getItem(LEGACY_WRAP_KEY)) !== "false"; } catch { return true; }
};

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.wrapped = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.wrap = wrapPref();
    this.areaWidth = 0;
    // This copy's own id: a menu choice runs only in the panel that opened it.
    this.panelId = Math.random().toString(36).slice(2);
    this.lastRunAt = 0;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    cx.timer.every(200, (cx) => this.handleRun(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map((l) => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map((line) => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...this.rows.map((row) => (row.text.length + 1) * 7 + 50));
    this.wrapRows();
  }

  // How many columns fit: the number gutter and the gap come off the width.
  columns() {
    return Math.max(20, Math.floor(((this.areaWidth || 360) - GUTTER) / CHAR_PX));
  }

  wrapRows() {
    const cols = this.columns();
    this.wrapped = this.rows.map((row) => {
      if (!this.wrap || row.kind === "@" || !row.text) return { ...row, chunks: [row.text] };
      return { ...row, chunks: splitColumns(row.text, cols) };
    });
  }

  measure(width, cx) {
    if (Math.abs(this.areaWidth - width) < 1) return;
    this.areaWidth = width;
    if (this.wrap && this.rows.length) {
      this.wrapRows();
      cx.notify();
    }
  }

  toggleWrap(cx) {
    this.wrap = !this.wrap;
    try { localStorage.setItem(WRAP_KEY, String(this.wrap)); } catch { /* a mod without storage still wraps */ }
    this.wrapRows();
    cx.notify();
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  // Right-click a changed file. Commands run on this machine, so a repository
  // on another machine has no menu.
  menu(path) {
    if (this.on || !this.root) return;
    openMenu({ panel: "changes", panelId: this.panelId, path: `${this.root}/${path}`, dir: false });
  }

  handleRun(cx) {
    const req = takeRun(this.panelId, this.lastRunAt);
    if (!req) return;
    this.lastRunAt = req.at;
    cx.spawn(async () => { await runAction(req.action, req.path, req.dir); });
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  diffRow(row, t) {
    if (row.kind === "@") return div().w_full().px(12).h(LINE).flex_none().truncate().bg(t.raised).text_color(t.dim).child(row.text);
    const chunks = row.chunks?.length ? row.chunks : [row.text];
    return h_flex().w_full().h(LINE * chunks.length).flex_none().items_start().gap(10).when(row.kind === "+", (e) => e.bg(t.ansi2 + "18")).when(row.kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(row.number === undefined ? "" : String(row.number)))
      .child(v_flex().flex_1().min_w(0).children(chunks.map((chunk) =>
        div().w_full().h(LINE).flex_none().truncate().child(chunk || " "))));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).rounded(0).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(36).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_family(MONO).font_bold().text_size(11).text_color(t.muted).child("CHANGES"))
        .child(
          h_flex()
            .flex_none()
            .px(4)
            .h(15)
            .items_center()
            .justify_center()
            .rounded(0)
            .bg(t.canvas)
            .border_1()
            .border_color(t.border)
            .font_family(MONO)
            .text_size(10)
            .text_color(t.accent)
            .child(`[${this.files.length}]`),
        )
        .child(div().flex_1())
        .child(
          h_flex()
            .id("changes-wrap")
            .flex_none()
            .h(18)
            .px(6)
            .items_center()
            .justify_center()
            .rounded(0)
            .bg(this.wrap ? "#38bdf81c" : "#00000000")
            .border_1()
            .border_color(this.wrap ? t.accent : t.border)
            .font_family(MONO)
            .text_size(9.5)
            .text_color(this.wrap ? t.foreground : t.muted)
            .cursor_pointer()
            .on_click((_e, cx) => this.toggleWrap(cx))
            .child("WRAP"),
        )
        .child(div().flex_none().font_family(MONO).text_size(10).text_color(t.ansi2).child(`+${add}`))
        .child(div().flex_none().font_family(MONO).text_size(10).text_color(t.ansi1).child(`−${del}`)))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).max_h(this.files.length * 28 + 12).relative().border_b(1).border_color(t.border)
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).relative().h(28).flex_none().px(8).gap(8).items_center().rounded(0).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).when(this.open === f.path, (e) => e.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent))).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(f.path); })
          .child(div().w(14).flex_none().font_family(MONO).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, (el) => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().id("changes-diff-area").flex_1().min_h(0).relative().bg("#07090d").font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        // on_size_change 回报缩放后像素：除以 zoom 才是折行要用的实际栏宽。
        .on_size_change((size, cx) => this.measure(size.width / ZOOM(), cx))
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.wrap ? 0 : this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.wrapped.length, this.wrapped.map((row) => LINE * (row.chunks?.length ?? 1)), (i) => String(i),
            (range) => this.wrapped.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(0).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().justify_center().rounded(0).when(enabled, (e) => e.bg(t.accent).text_color(t.accent_foreground)).when(!enabled, (e) => e.bg(t.surface).border_1().border_color(t.border).text_color(t.dim)).font_family(MONO).font_bold().text_size(10.5).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "COMMITTING…" : "COMMIT")));
  }
}
