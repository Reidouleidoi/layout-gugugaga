// 咕咕嘎嘎 Agents 卡片：把 agents() 畫成職業肖像卡片，狀態、模型與子代理樹都畫在同一張卡上。
// 讀 jobs.json 與 data/traveler/sessions 快取；沒有快取時會跑 `hc read <address> --lines 25` 抓終端尾端解析模型。
// 不連網、不讀憑證、不寫任何檔案；沒有資料就不畫那一段。
import { readdir } from "fs/promises";
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, hc, readTextFile, run, setAgentOrder, spaces, terminals, theme, watchFolder } from "herdr";
import { assignJobs, cachePath, jobIn, modelText, parseCache, parseTerminalModel, portraitPath, remoteCachePath, resolveAppInfo, setGugugagaPools, spritePath, tabNames } from "./lib.js";

const HOME = appHome();
const SESSIONS_DIR = `${HOME}/data/traveler/sessions`;
const JOBS_FILE = `${HOME}/mods/gugugaga-agents/jobs.json`;
const PIC = 48;
// Full-body sprites are 48x64 logical pixels (3:4); rendered 1:1 so pixel art stays crisp.
const SPRITE_W = 48;
const SPRITE_H = 64;
const ENTRY_H = 64;
const STATUS = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };
const withAlpha = (c, a) => (typeof c === "string" && c.startsWith("#") ? `${c.slice(0, 7)}${a}` : c);

// ── 小隊梯（子代理）：巢狀關係只存在 terminals() 的 parent 上，agents() 沒有這個欄位。
// 對齊 gugugaga-spaces 的像素 outliner：2px 樹幹、9x2 橫枝、5px 方塊節點。
const SQUAD_H = 17; // 子代理列高
const SQUAD_GAP = 2; // 列與列之間留 2px，由樹幹補滿，接縫不會斷
const TRUNK_X = 14; // 第一層樹幹的 x
const DEPTH_STEP = 12; // 每深一層右移
const DEPTH_MAX = 2; // 面板只有 268 寬，縮排最多兩層
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// 子代理狀態：有自己 pane 的以 agents() 為準，沒有 pane 的只信 core 的 status。
// error 算 blocked；子代理不宣告 done，它做完是回報給父母，父母的 done 才是消息。
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status ?? "idle";
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// 肖像：配到職業就畫肖像圖；沒配到退回程式圖示（單色用 svg、圖片用 image），都沒有就留空。
// 以每個 agent 自己的 address 當作快取 key，彼此與各狀態互不影響。
function portrait(a, assigned, t) {
  const job = jobIn(a.tab_name, assigned);
  const sprite = spritePath(job, a.status, a.address);
  if (sprite) return image(sprite).w(SPRITE_W).h(SPRITE_H).flex_none();
  const src = portraitPath(job, a.address);
  if (src) return image(src).w(PIC).h(PIC).flex_none();
  const p = a.program;
  if (!p?.icon) return div().w(SPRITE_W).h(SPRITE_H).flex_none();
  return div()
    .w(SPRITE_W)
    .h(SPRITE_H)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .child(p.tint ? svg(p.icon).size(24).text_color(t.foreground) : image(p.icon).w(24).h(24));
}

// Pixel agent logo + name badge inside the plate.
function agentBadge(info, t) {
  const color = info.color ?? t.accent;
  return h_flex()
    .flex_none()
    .h(14)
    .px(3)
    .gap(3)
    .items_center()
    .rounded(3)
    .bg(withAlpha(t.canvas, "e0"))
    .border(1)
    .border_color(withAlpha(color, "88"))
    .child(info.tint ? svg(info.logo).size(11).flex_none().text_color(color) : image(info.logo).size(11).flex_none())
    .child(div().flex_none().font_semibold().text_size(9).text_color(color).child(info.short || info.text));
}

// 狀態記號：卡片徽章與子代理列共用同一組像素字形。
function statusMark(status, statusColor) {
  return status === "working"
    ? div().flex_none().text_size(9).text_color(statusColor).frames(["▘", "▝", "▗", "▖"], 140)
    : status === "blocked"
      ? div().w(7).flex().items_center().justify_center().font_bold().text_size(9.5).text_color(statusColor).frames(["!", " "], 600)
      : div().flex_none().text_size(9).text_color(statusColor).child(status === "done" ? "✓" : "▪");
}

// Pixel status badge for Row 1 right side.
function statusBadge(status, statusColor, t) {
  const label = STATUS[status] ?? status;
  return h_flex()
    .flex_none()
    .h(14)
    .px(5)
    .gap(3)
    .items_center()
    .rounded(4)
    .bg(withAlpha(statusColor, "1a"))
    .border(1)
    .border_color(withAlpha(statusColor, "44"))
    .child(statusMark(status, statusColor))
    .child(div().flex_none().text_size(9.5).font_medium().text_color(statusColor).child(label));
}

// Compute entry height, vertical step, and staggered character lanes so text never
// gets occluded by sprites in multi-agent mode.
function stackMetrics(count, panelH) {
  if (count <= 2) {
    return { cardH: ENTRY_H, stepY: ENTRY_H + 4, offsets: [4], textPl: 60 };
  }
  const availH = Math.max(220, (panelH || 380) - 16);
  const idealStep = Math.floor((availH - ENTRY_H) / (count - 1));
  const stepY = Math.max(46, Math.min(56, idealStep));
  return { cardH: ENTRY_H, stepY, offsets: [2, 34], textPl: 88 };
}

export default class Traveler extends View {
  init(_props, cx) {
    this.jobs = {};
    this.cache = {};
    this.remote = {};
    this.screenModels = {};
    this.lastSeq = {};
    this.lastScreenRead = 0;
    this.readingScreen = false;
    this.tick = 0;
    this.seen = new Set();
    this.watching = false;
    this.panelH = 0;
    this.panelW = 0;
    this.hovered = null;
    this.folded = new Set(); // 折起來的子代理：address
    this.listed = new Map(); // address -> agents() 的狀態（有 pane 的子代理用這個）
    this.focusedAgent = null;
    this.loadJobs(cx);
    this.loadPools(cx);
    this.watchPools(cx);
    this.load(cx);
    this.loadRemote(cx);
    this.loadScreenModels(cx, true);
    this.watch(cx);
    // 資料是數字，最多 30 秒看一次就夠；也讓「舊」標記自己出現，順便重試監看。
    cx.timer.every(30000, (cx) => {
      this.loadPools(cx);
      this.load(cx);
      this.loadScreenModels(cx, true);
      this.watch(cx);
      // 遠端每 60 秒讀一次，跟 statusLine 的更新間隔一樣；遠端資料夾不能監看。
      if (++this.tick % 2 === 0) this.loadRemote(cx);
    });
  }

  // 動態掃描 art/gugugaga 與 sprites/gugugaga/{r,w,b}，手動增刪檔案時自動同步清單。
  loadPools(cx) {
    const scan = async (relDir, exts) => {
      try {
        const names = await readdir(`${HOME}/${relDir}`);
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
    const dirs = [
      `${HOME}/mods/gugugaga-agents/art/gugugaga`,
      `${HOME}/mods/gugugaga-agents/sprites/gugugaga/r`,
      `${HOME}/mods/gugugaga-agents/sprites/gugugaga/w`,
      `${HOME}/mods/gugugaga-agents/sprites/gugugaga/b`,
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
  // Fallback：當没有 session 快取檔時，從 terminal 畫面尾端解析当前模型與 effort。
  loadScreenModels(cx, force = false) {
    if (this.readingScreen) return;
    const now = Date.now();
    if (!force && now - this.lastScreenRead < 5000) return;
    const targets = [];
    for (const a of agents()) {
      const hasCache = Boolean((this.cache[a.address] ?? this.remote[a.address])?.model);
      if (hasCache) continue;
      const changed = force || !(a.address in this.screenModels) || this.lastSeq[a.address] !== a.seq;
      if (!changed) continue;
      this.lastSeq[a.address] = a.seq;
      targets.push({ address: a.address, appKey: resolveAppInfo(a).key });
    }
    if (targets.length === 0) return;
    this.lastScreenRead = now;
    this.readingScreen = true;
    cx.spawn(async (cx) => {
      try {
        let dirty = false;
        const next = { ...this.screenModels };
        for (const t of targets) {
          try {
            const r = await hc(["read", t.address, "--lines", "25"]);
            if (r.code === 0) {
              const parsed = parseTerminalModel(r.stdout, t.appKey);
              const prev = next[t.address] ?? null;
              if (parsed) {
                if (prev?.model !== parsed.model || prev?.effort !== parsed.effort) {
                  next[t.address] = parsed;
                  dirty = true;
                }
              } else if (!(t.address in next)) {
                next[t.address] = null;
              }
            } else if (!(t.address in next)) {
              next[t.address] = null;
            }
          } catch {
            if (!(t.address in next)) next[t.address] = null;
          }
        }
        this.screenModels = next;
        if (dirty) cx.notify();
      } finally {
        this.readingScreen = false;
      }
    });
  }

  // 監看快取資料夾：有變更就重讀。資料夾不存在或不被允許時結束迴圈，
  // 交給上面的計時器每 30 秒重試，不會變成緊迴圈。
  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      let quick = 0;
      for (;;) {
        let changed;
        const started = Date.now();
        try {
          changed = await watchFolder(SESSIONS_DIR);
        } catch {
          break;
        }
        // 立刻回來又沒有任何變更，代表監看沒真的生效，也別讓它空轉。
        quick = Date.now() - started < 500 && (changed ?? []).length === 0 ? quick + 1 : 0;
        if (quick >= 3) break;
        this.load(cx);
      }
      this.watching = false;
    });
  }

  loadJobs(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(JOBS_FILE).catch(() => null);
      let jobs = {};
      try {
        const parsed = JSON.parse(text);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) jobs = parsed;
      } catch {
        jobs = {};
      }
      this.jobs = jobs;
      cx.notify();
    });
  }

  // 每個本機 agent 讀自己那份快取；遠端的由 loadRemote 讀。
  load(cx) {
    const wanted = [];
    for (const a of agents()) {
      const path = cachePath(HOME, a.address);
      if (path === null) continue;
      this.seen.add(a.address);
      wanted.push({ address: a.address, path });
    }
    cx.spawn(async (cx) => {
      const next = {};
      for (const w of wanted) {
        const text = await readTextFile(w.path).catch(() => null);
        next[w.address] = parseCache(text);
      }
      this.cache = next;
      cx.notify();
    });
  }

  // 遠端 agent 讀它那台的快取檔（透過 Herdr 原有的連線，不執行指令）；連不上就是 null，畫面顯示「—」。
  loadRemote(cx) {
    const wanted = [];
    for (const a of agents()) {
      const r = remoteCachePath(a.address);
      if (r === null) continue;
      this.seen.add(a.address);
      wanted.push({ address: a.address, ...r });
    }
    if (wanted.length === 0) return;
    cx.spawn(async (cx) => {
      const next = {};
      for (const w of wanted) {
        const text = await readTextFile(w.path, { on: w.on }).catch(() => null);
        next[w.address] = parseCache(text);
      }
      this.remote = next;
      cx.notify();
    });
  }

  // parent address -> 依模型順序的 live 子終端（terminals() 的 parent 欄位）。
  childIndex(all) {
    const kids = new Map();
    for (const k of all) {
      if (k.state !== "live" || !k.parent) continue;
      const arr = kids.get(k.parent);
      if (arr) arr.push(k);
      else kids.set(k.parent, [k]);
    }
    return kids;
  }

  // 深度優先列出 addr 的子代理。lead[d] 表示第 d 層祖先還有下一個兄弟，
  // 所以那一層要補一條連到下一個的垂直樹幹；last 是目前這列的最後一個。
  subtree(kids, addr, depth = 0, lead = []) {
    const list = kids.get(addr) ?? [];
    if (depth > DEPTH_MAX + 2) return [];
    return list.flatMap((k, i) => {
      const last = i === list.length - 1;
      return [
        { k, depth, last, lead },
        ...this.subtree(kids, k.address, depth + 1, [...lead, !last]),
      ];
    });
  }

  // 把 top-level 卡片、子代理列與接縫樹幹排成 y 座標。
  // 有子代理的條目用完整節奏（cardH + 4），不然 64px 的立繪會壓到第一列。
  stackLayout(list, kids, m) {
    const cards = [];
    const subs = [];
    const stubs = [];
    let y = 0;
    let bottom = 0;
    list.forEach((a, i) => {
      const children = this.subtree(kids, a.address);
      const open = children.length > 0 && !this.folded.has(a.address);
      const start = y;
      // 最緊急的子代理決定徽章顏色（卡片本身只看自己的狀態）。
      const urgent = children.reduce((best, s) => {
        const st = kidStatus(s.k, this.listed);
        return (RANK[st] ?? 0) > (RANK[best] ?? 0) ? st : best;
      }, null);
      cards.push({ a, i, y: start, count: children.length, open, urgent });
      y = start + (children.length > 0 ? m.cardH + 4 : m.stepY);
      bottom = start + m.cardH;
      if (!open) return;
      // 從 plate 底部接第一列：由 stub 補齊到 first，列與列之間由各列的樹幹補。
      const trunkX = m.offsets[i % m.offsets.length] + 22;
      const first = start + m.cardH + SQUAD_GAP;
      stubs.push({ x: trunkX, y: start + m.cardH - 6, h: 6 + SQUAD_GAP });
      children.forEach((s, n) => subs.push({ ...s, trunkX, y: first + n * (SQUAD_H + SQUAD_GAP) }));
      bottom = first + (children.length - 1) * (SQUAD_H + SQUAD_GAP) + SQUAD_H;
      y = bottom + SQUAD_GAP + 2;
    });
    return { cards, subs, stubs, totalH: bottom > 0 ? bottom + 4 : 0 };
  }

  // 卡片 Row 1 的小隊徽章：折疊開關＋人數，顏色跟最緊急的子代理走。
  squadChip(a, card, t) {
    const color = t[card.urgent] ?? t.dim;
    const open = card.open;
    return h_flex()
      .id(`squad-${a.address}`)
      .flex_none()
      .h(14)
      .px(4)
      .gap(2)
      .items_center()
      .rounded(4)
      .bg(withAlpha(color, "1a"))
      .border(1)
      .border_color(withAlpha(color, "44"))
      .cursor_pointer()
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (open) this.folded.add(a.address);
        else this.folded.delete(a.address);
        cx.notify();
      })
      .child(div().flex_none().text_size(8.5).text_color(color).child(open ? "▾" : "▸"))
      .child(div().flex_none().text_size(9).font_semibold().text_color(color).child(String(card.count)));
  }

  // 子代理列：像素 outliner 的樹幹／橫枝／方塊節點，右側接一行窄資訊（不用立繪，沒有新 GIF）。
  subRow(s, t) {
    const k = s.k;
    const st = kidStatus(k, this.listed);
    const color = t[st] ?? t.dim;
    const trunk = withAlpha(t.accent, "55");
    const baseTrunk = s.trunkX ?? TRUNK_X;
    const x = (d) => baseTrunk + Math.min(d, DEPTH_MAX) * DEPTH_STEP;
    const gx = x(s.depth);
    const info = resolveAppInfo(k);
    const name = k.name || k.template || k.program?.name || k.address;
    const logo = !info.logo
      ? null
      : info.tint
        ? svg(info.logo).size(11).flex_none().text_color(color)
        : image(info.logo).w(11).h(11).flex_none();
    const gutter = [];
    // 祖先層：貫穿這一列並多走 SQUAD_GAP，接上下一個兄弟。
    for (let d = 0; d < s.lead.length; d++) {
      if (!s.lead[d]) continue;
      gutter.push(div().absolute().left(x(d)).top(0).w(2).h(SQUAD_H + SQUAD_GAP).bg(trunk));
    }
    // 自己這層：非最後一個走滿，最後一個只走到橫枝；橫枝與節點對齊 y=8。
    gutter.push(div().absolute().left(gx).top(0).w(2).h(s.last ? 10 : SQUAD_H + SQUAD_GAP).bg(trunk));
    gutter.push(div().absolute().left(gx).top(8).w(9).h(2).bg(trunk));
    gutter.push(div().absolute().left(gx + 9).top(6).size(5).bg(color).border(1).border_color(t.accent_foreground ?? t.canvas));
    return div()
      .id(`traveler-sub-${k.address}`)
      .absolute()
      .left(0)
      .right(6)
      .top(s.y)
      .h(SQUAD_H)
      .cursor_pointer()
      .when(k.address === this.focusedAgent, (el) => el.bg(withAlpha(t.raised, "dd")))
      .hover((el) => el.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : run("terminal.peek", { terminal: k.address })))
      .child(
        div()
          .size_full()
          .relative()
          .children(gutter)
          .child(
            h_flex()
              .absolute()
              .left(gx + 17)
              .right(0)
              .top(0)
              .h(SQUAD_H)
              .gap(3)
              .items_center()
              .when(Boolean(logo), (el) => el.child(logo))
              .child(div().flex_1().min_w(0).truncate().text_size(9.5).text_color(t.muted).child(name))
              .when(Boolean(info.short), (el) => el.child(div().flex_none().text_size(8).text_color(t.dim).child(info.short)))
              .child(statusMark(st, color)),
          ),
      );
  }

  cardPlate(a, i, m, t, card) {
    const cache = this.cache[a.address] ?? this.remote[a.address] ?? null;
    const screen = this.screenModels[a.address] ?? null;
    const isHot = this.hovered === a.address;
    // blocked 優先級最高：plate 框線與狀態色都用 t.blocked，蓋過 focused 的 t.accent。
    const plateBorder = a.status === "blocked" ? t.blocked : a.focused || isHot ? t.accent : withAlpha(t.border, "99");
    const statusColor = a.status === "blocked" ? t.blocked : t[a.status] ?? t.dim;
    const info = resolveAppInfo(a);
    const model = modelText(cache?.model ?? screen?.model, cache?.effort ?? screen?.effort);
    const modelLine = model || cache?.name || a.space_name || "ready";
    const tabRaw = String(a.tab_name || "").trim();
    const numericTab = /^\d+$/.test(tabRaw);
    const spaceName = a.space_name || a.address;
    const spriteX = m.offsets[i % m.offsets.length];
    return div()
      .id(`traveler-${a.address}`)
      .absolute()
      .left(0)
      .right(0)
      .top(card.y)
      .h(m.cardH)
      .when(a.focused, (el) => el.rounded(6).bg(withAlpha(t.raised, "88")))
      .when(!a.focused && isHot, (el) => el.rounded(6).bg(withAlpha(t.raised, "55")))
      .cursor_pointer()
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(
        div()
          .absolute()
          .left(spriteX + 10)
          .bottom(0)
          .w(28)
          .h(3)
          .bg(a.status === "blocked" ? withAlpha(t.blocked, "55") : withAlpha(t.foreground, "22")),
      )
      .child(
        v_flex()
          .size_full()
          .pl(m.textPl)
          .pr(6)
          .pb(6)
          .justify_end()
          .gap(2)
          .child(
            h_flex()
              .w_full()
              .min_w(0)
              .h(14)
              .px(3)
              .gap(4)
              .items_center()
              .bg(withAlpha(t.canvas, "66"))
              .when(numericTab, (row) =>
                row
                  .child(div().flex_none().font_semibold().text_size(11).text_color(t.accent).child(`#${tabRaw}`))
                  .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(11.5).text_color(t.foreground).child(spaceName)),
              )
              .when(!numericTab, (row) =>
                row.child(
                  h_flex()
                    .flex_1()
                    .min_w(0)
                    .gap(4)
                    .items_center()
                    .child(div().min_w(0).truncate().font_semibold().text_size(11.5).text_color(t.foreground).child(tabRaw || spaceName))
                    .when(Boolean(tabRaw && a.space_name && tabRaw !== a.space_name), (el) =>
                      el.child(div().min_w(0).truncate().text_size(10.5).text_color(t.muted).child(`· ${a.space_name}`)),
                    ),
                ),
              )
              .when(card.count > 0, (row) => row.child(this.squadChip(a, card, t)))
              .child(statusBadge(a.status, statusColor, t)),
          )
          .child(
            h_flex()
              .relative()
              .w_full()
              .min_w(0)
              .h(18)
              .pl(4)
              .pr(3)
              .gap(3)
              .items_center()
              .rounded(4)
              .bg(withAlpha(t.canvas, "cc"))
              .border(1)
              .border_color(plateBorder)
              .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(statusColor))
              .child(agentBadge(info, t))
              .child(
                h_flex()
                  .flex_1()
                  .min_w(0)
                  .gap(2)
                  .items_center()
                  .child(div().flex_none().text_size(8.5).text_color(t.accent).child("◈"))
                  .child(div().flex_1().min_w(0).truncate().text_size(8.5).text_color(model ? t.foreground : t.dim).child(modelLine)),
              ),
          ),
      );
  }

  spriteNode(a, i, m, t, y) {
    const spriteX = m.offsets[i % m.offsets.length];
    return div()
      .id(`traveler-sprite-${a.address}`)
      .absolute()
      .left(spriteX)
      .top(y)
      .w(SPRITE_W)
      .h(SPRITE_H)
      .cursor_pointer()
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(portrait(a, this.assigned, t));
  }

  rail(list, t) {
    return v_flex()
      .flex_1()
      .min_h(0)
      .p(4)
      .gap(4)
      .items_center()
      .overflow_y_scrollbar()
      .children(
        list.map((a) =>
          div()
            .id(`traveler-rail-${a.address}`)
            .w(52)
            .h(68)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .border(1)
            .border_color(a.status === "blocked" ? t.blocked : a.focused ? t.accent : t.border)
            .bg(a.focused ? withAlpha(t.raised, "ee") : withAlpha(t.surface, "c8"))
            .cursor_pointer()
            .on_click(() => run("agent.focus", { terminal: a.address }))
            .child(portrait(a, this.assigned, t)),
        ),
      );
  }

  render(cx) {
    const t = theme();
    const base = agents();
    this.assigned = assignJobs(tabNames(spaces(), base), this.jobs);
    // 剛出現的 agent 先補讀一次快取，不用等下一次計時器。
    const fresh = base.filter((a) => !this.seen.has(a.address));
    if (fresh.some((a) => cachePath(HOME, a.address) !== null)) this.load(cx);
    if (fresh.some((a) => remoteCachePath(a.address) !== null)) this.loadRemote(cx);
    if (base.some((a) => !((this.cache[a.address] ?? this.remote[a.address])?.model) && (!(a.address in this.screenModels) || this.lastSeq[a.address] !== a.seq))) {
      this.loadScreenModels(cx, false);
    }

    const compactRail = this.panelW > 0 && this.panelW < 150;
    // 巢狀關係只在 terminals() 的 parent 上。nested 涵蓋所有 live 子代理，不看收合狀態：
    // 折起一個父母時，子代理也不能彈出來變成另一張 top-level 卡片。
    const kids = this.childIndex(compactRail ? [] : terminals());
    const nested = new Set();
    for (const a of base) for (const s of this.subtree(kids, a.address)) nested.add(s.k.address);
    const list = base.filter((a) => a.pinned || !nested.has(a.address));
    this.listed = new Map(base.map((a) => [a.address, a.status]));
    this.focusedAgent = base.find((a) => a.focused)?.address ?? null;
    // 折疊狀態只清掉真的消失的父母；窄側邊欄沒有折疊 UI，不要因此清光。
    if (!compactRail) for (const key of this.folded) if (!kids.has(key)) this.folded.delete(key);
    setAgentOrder(list.map((a) => a.address));

    const m = stackMetrics(list.length, this.panelH);
    const plan = compactRail ? { cards: [], subs: [], stubs: [], totalH: 0 } : this.stackLayout(list, kids, m);

    return v_flex()
      .id("traveler")
      .size_full()
      .min_h(0)
      .text_color(t.foreground)
      .text_size(13)
      .on_size_change((size, cx) => {
        if (
          !this.panelH ||
          Math.abs(this.panelH - size.height) > 2 ||
          Math.abs(this.panelW - size.width) > 2
        ) {
          this.panelH = size.height;
          this.panelW = size.width;
          cx.notify();
        }
      })
      .when(compactRail, (el) => el.child(this.rail(list, t)))
      .when(!compactRail, (el) =>
        el
          .child(
            h_flex()
              .h(22)
              .pl(16)
              .pr(10)
              .gap(6)
              .items_center()
              .flex_none()
              .text_size(11)
              .text_color(t.accent)
              .child(div().font_semibold().child("Party"))
              .child(
                h_flex()
                  .flex_none()
                  .px(4)
                  .h(15)
                  .items_center()
                  .justify_center()
                  .rounded(4)
                  .border(1)
                  .border_color(withAlpha(t.border, "66"))
                  .bg(withAlpha(t.canvas, "bb"))
                  .text_size(10)
                  .text_color(t.accent)
                  .child(`[${list.length}]`),
              ),
          )
          .child(
            v_flex()
              .flex_1()
              .min_h(0)
              .p(6)
              .overflow_y_scrollbar()
            .when(list.length > 0, (sc) =>
              sc.child(
                div()
                  .relative()
                  .w_full()
                  .h(plan.totalH)
                  .flex_none()
                  .children(plan.cards.map((c) => this.cardPlate(c.a, c.i, m, t, c)))
                  .children(plan.stubs.map((s) => div().absolute().left(s.x).top(s.y).w(2).h(s.h).bg(withAlpha(t.accent, "55"))))
                  .children(plan.subs.map((s) => this.subRow(s, t)))
                  .children(plan.cards.map((c) => this.spriteNode(c.a, c.i, m, t, c.y))),
              ),
            )
            .when(list.length === 0, (sc) =>
              sc.child(div().p(8).text_size(12).text_color(t.dim).child("No agents")),
            ),
        ),
      );
  }
}
