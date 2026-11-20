import { readdir } from "fs/promises";
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, spaces, panes, run, openOverlay, theme, window, shared, layout, settings, appHome, readTextFile, watchFolder } from "herdr";
import { assignJobs, jobIn, portraitPath, resolveAppInfo, setGugugagaPools, spritePath, tabNames, withAlpha } from "./lib.js";

const JOBS_FILE = `${appHome()}/mods/gugugaga-agents/jobs.json`;
const MONO_FONT = "Cascadia Mono";
const STATUS_LABELS = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };
// 與 gugugaga-agents 的 STATUS_SKIN 同一套配色（深底 + 狀態色細框）。
const STATUS_SKIN = {
  working: { bg: "#0e2238fa", border: "#8ccaffdd", text: "#d8eeff" },
  blocked: { bg: "#241708f8", border: "#ffb547ee", text: "#ffd080" },
  done: { bg: "#0d1d18f5", border: "#7fd8a899", text: "#9ae6be" },
  idle: { bg: "#0d131cf0", border: "#5d687866", text: "#7c8a9e" },
};

function tabAgentLogo(info, t) {
  const color = info.color ?? t.accent;
  return h_flex()
    .flex_none()
    .size(16)
    .items_center()
    .justify_center()
    .rounded(0)
    .bg(withAlpha(t.canvas, "e0"))
    .border(1)
    .border_color(withAlpha(color, "88"))
    .tooltip(info.text)
    .child(info.tint ? svg(info.logo).size(11).flex_none().text_color(color) : image(info.logo).size(11).flex_none());
}

function tabStatusBadge(status, t) {
  const skin = STATUS_SKIN[status] ?? STATUS_SKIN.idle;
  const color =
    status === "blocked"
      ? t.blocked ?? t.solid
      : t[status] ?? t.dim;
  const label = STATUS_LABELS[status] ?? String(status).toUpperCase();
  const mark =
    status === "working"
      ? div().w(9).flex().items_center().justify_center().text_size(9).text_color(color).frames(["▘", "▝", "▗", "▖"], 140)
      : status === "blocked"
        ? div().w(9).flex().items_center().justify_center().font_bold().text_size(9.5).text_color(color).frames(["!", " "], 450)
        : div().flex_none().text_size(9).text_color(color).child(status === "done" ? "✓" : "▪");
  return h_flex()
    .flex_none()
    .h(15)
    .px(5)
    .gap(3)
    .items_center()
    .rounded(0)
    .bg(skin.bg)
    .border(1)
    .border_color(skin.border)
    .child(mark)
    .child(div().flex_none().font_family(MONO_FONT).text_size(9).font_semibold().text_color(skin.text).child(label));
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.jobs = {};
    this.poolSig = null;
    cx.spawn(async (cx) => {
      const text = await readTextFile(JOBS_FILE).catch(() => null);
      try { const parsed = JSON.parse(text); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.jobs = parsed; } catch {}
      cx.notify();
    });
    this.loadPools(cx);
    this.watchPools(cx);
    cx.timer.every(30000, (cx) => this.loadPools(cx));
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // 動態掃描 art/gugugaga 與 sprites/gugugaga/{r,w,b}，手動增刪檔案時自動同步清單。
  loadPools(cx) {
    const home = appHome();
    const scan = async (relDir, exts) => {
      try {
        const names = await readdir(`${home}/${relDir}`);
        return names
          .filter((n) => !n.startsWith(".") && exts.some((e) => n.toLowerCase().endsWith(e)))
          .sort()
          .map((n) => relDir + "/" + n);
      } catch {
        return null;
      }
    };
    cx.spawn(async (cx) => {
      const [portrait, rest, working, blocked] = await Promise.all([
        scan("mods/gugugaga-agents/art/gugugaga", [".png", ".jpg", ".jpeg", ".webp", ".gif"]),
        scan("mods/gugugaga-agents/sprites/gugugaga/r", [".gif", ".png", ".webp"]),
        scan("mods/gugugaga-agents/sprites/gugugaga/w", [".gif", ".png", ".webp"]),
        scan("mods/gugugaga-agents/sprites/gugugaga/b", [".gif", ".png", ".webp"]),
      ]);
      const next = {};
      if (portrait) next.portrait = portrait;
      if (rest) next.rest = rest;
      if (working) next.working = working;
      if (blocked) next.blocked = blocked;
      const sig = JSON.stringify(next);
      if (Object.keys(next).length > 0 && sig !== this.poolSig) {
        this.poolSig = sig;
        setGugugagaPools(next);
        cx.notify();
      }
    });
  }

  watchPools(cx) {
    const home = appHome();
    const dirs = [
      `${home}/mods/gugugaga-agents/art/gugugaga`,
      `${home}/mods/gugugaga-agents/sprites/gugugaga/r`,
      `${home}/mods/gugugaga-agents/sprites/gugugaga/w`,
      `${home}/mods/gugugaga-agents/sprites/gugugaga/b`,
    ];
    for (const dir of dirs) {
      cx.spawn(async (cx) => {
        let quick = 0;
        for (;;) {
          const started = Date.now();
          let changed;
          try {
            changed = await watchFolder(dir);
          } catch {
            break;
          }
          quick = Date.now() - started < 500 && (changed ?? []).length === 0 ? quick + 1 : 0;
          if (quick >= 3) break;
          this.loadPools(cx);
        }
      });
    }
  }
  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const assigned = assignJobs(tabNames(spaces(), agents()), this.jobs);
    const stop = (_e, cx) => cx.stop_propagation();
    // 1px × 16px 分隔线：图标群之间的一道细缝。
    const separator = () => div().w(1).h(16).flex_none().bg("#232a36");
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(0).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const allAgents = agents();
    const allPanes = panes();
    const item = (c, i) => {
      const tabAgent = allAgents.find(a => a.tab === c.id);
      const tabPane = allPanes.find(p => p.tab === c.id && p.program?.agent) ?? allPanes.find(p => p.tab === c.id);
      const program = tabAgent?.program ?? tabPane?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const job = jobIn(c.name, assigned);
      const isAgent = Boolean(tabAgent || program?.agent || c.status);
      const appInfo = isAgent ? resolveAppInfo({ app: tabAgent?.app ?? tabPane?.app, program }) : null;
      const status = c.status ?? tabAgent?.status ?? (isAgent ? "idle" : null);
      // Tab 欄優先用靜態頭像 (a/)，以 tab id 快取，沒有才退回 sprites。
      const portrait = portraitPath(job, c.id);
      const sprite = portrait ? null : spritePath(job, status, c.id);
      const borderColor = status === "blocked" ? t.blocked : c.active ? t.accent : "#232a36";
      // 顶部 2px 语义色条：优先取 tab 主 Agent 的 CLI 色，blocked 用琥珀。
      const semantic = status === "blocked" ? t.blocked : appInfo?.color ?? t.accent;
      return h_flex().id(`tab-${c.id}`).relative().h(48).px(8).gap(6).items_center().flex_none().rounded(0).text_size(12.5)
        .border(1).border_color(borderColor).bg(c.active ? "#141924" : "#0d1118").text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(c.active ? "#141924" : t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(c.active || status === "blocked", el =>
          el.child(div().absolute().left(0).right(0).top(0).h(2).bg(semantic)))
        .when(c.active, el =>
          el
            .child(div().absolute().left(1).bottom(1).size(2).bg(semantic))
            .child(div().absolute().right(1).bottom(1).size(2).bg(semantic)))
        .when(Boolean(sprite), el => el.child(image(sprite).w(32).h(42).flex_none()))
        .when(Boolean(portrait), el => el.child(image(portrait).size(40).flex_none()))
        .when(!sprite && !portrait && Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .when(Boolean(appInfo), el => el.child(tabAgentLogo(appInfo, t)))
        .child(div().max_w(160).truncate().when(c.active, el => el.font_semibold()).child(c.zoomed ? `${name} Z` : name))
        .when(Boolean(status), el => el.child(tabStatusBadge(status, t)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).hover(s => s.text_color(t.foreground)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "inbox"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).relative().h(26).px(8).gap(6).flex_none().items_center().rounded(0)
        .border(1).border_color(on ? t.accent : "#232a36")
        .bg(on ? "#161d2b" : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        })
        // 激活时的底部 2px 指示条
        .when(on, (el) => el.child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
        .child(svg(icon).size(14).flex_none().text_color(on ? t.accent : t.muted))
        .child(div().flex_none().font_family(MONO_FONT).text_size(10).font_semibold().child(label));
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .child(separator())
      .when(enabled.includes("files"), el => el.child(panelButton("files", "FILES", "mods/gugugaga-chrome/files.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "CHANGES", "mods/gugugaga-chrome/git-compare.svg")))
      .child(panelButton("inbox", "INBOX", "mods/gugugaga-chrome/archive.svg"))
      .child(separator())
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/gugugaga-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/gugugaga-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/gugugaga-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
