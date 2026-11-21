// 咕咕嘎嘎 Agents 卡片：把 agents() 画成职业肖像卡片，状态、模型与子代理树都画在同一张卡上。
// 读 jobs.json 与 data/traveler/sessions 缓存；没有缓存时会跑 `hc read <address> --lines 25` 抓终端尾端解析模型。
// 不连网、不读凭证、不写任何文件；没有数据就不画那一段。
import { readdir } from "fs/promises";
import { View, Background, PathBuilder, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, hc, readTextFile, run, setAgentOrder, settings, spaces, terminals, theme, watchFolder } from "herdr";
import { assignJobs, cachePath, cliFrame, cliSkin, contextLabel, effortSpec, jobIn, mixHex, MODEL_POOL_KEYS, modelArtForFamily, modelFamily, modelLabel, parseCache, parseTerminalModel, portraitPath, remoteCachePath, resolveAppInfo, setGugugagaPools, setModelPools, spacePlaceArt, spritePath, tabNames } from "./lib.js";

const HOME = appHome();
const SESSIONS_DIR = `${HOME}/data/traveler/sessions`;
const JOBS_FILE = `${HOME}/mods/gugugaga-agents/jobs.json`;
const PLACES_FILE = `${HOME}/mods/gugugaga-spaces/places.json`;
const ORDER_KEY = "agents.order";
const PIC = 48;
// Sprites are 48x64 logical pixels (3:4); rendered 1:1 so pixel art stays crisp.
const SPRITE_W = 48;
const SPRITE_H = 64;
// 展示卡：左列极简阶梯像素托架（48x64 企鹅 + ━━┓┗━━ 连入名片底边）+ 240x96 像素铭牌（底边齐平挖槽 Space）。
const CARD_H = 109;
const CARD_GAP = 8;
const CARD_STEP = CARD_H + CARD_GAP;
const LEFT_W = 56; // 立绘列宽
const PLATE_X = LEFT_W + 8; // 铭牌左缘 = 64
const PLATE_W = 240;
const PLATE_H = 96;
const PLATE_TOP = 11; // 骑框徽章 h22、中线骑在 y=11 的顶框上
const PLATE_BOTTOM = PLATE_TOP + PLATE_H; // 107，名片底边绝对笔直基线
const ART_W = 112; // 立绘 @2x 224x180 -> 逻辑 112x90
const ART_H = 90;
const SPRITE_TOP = 10; // 企鹅 y=10..74，脚底稳踩在 y=74 水平托盘在线
const TRAY_X = 4;
const TRAY_W = 50; // x=4..54
const TRAY_Y = 74;
const DROP_X = 52; // x=52..54 直角下折至 y=107
const TAB_ROW_TOP = 80;
const TAB_ROW_H = 20; // y=80..100，居中于企鹅正下方 x=4..50
const NOTCH_LEFT_IN_PLATE = 10;
const NOTCH_W = 142; // 完整态挖槽宽；窄态由 plateW 收敛
const NOTCH_H = 19; // bottom 严格齐平 y=107，绝不下凸破框
const NARROW_PX = 160; // 窄轨门槛：与 gugugaga-spaces / gugugaga-chrome 同一个数
const FOLD_WIDE_PX = 320; // Party 收缩扣的两档宽度
const FOLD_NARROW_PX = 196;
const MONO_FONT = "Cascadia Mono";
const PLATE_INK = "#070b12";
const withAlpha = (c, a) => (typeof c === "string" && c.startsWith("#") ? `${c.slice(0, 7)}${a}` : c);

// ── 小队梯（子代理）：嵌套关系只存在 terminals() 的 parent 上，agents() 没有这个字段。
// 对齐 gugugaga-spaces 的像素 outliner：2px 树干、9x2 横枝、5px 方块节点。
const SQUAD_H = 17; // 子代理列高
const SQUAD_GAP = 2; // 列与列之间留 2px，由树干补满，接缝不会断
const TRUNK_X = 27; // 树干对齐企鹅与 #Tab 正下方中心
const DEPTH_STEP = 12; // 每深一层右移
const DEPTH_MAX = 3; // 320px 侧栏可以容纳三层缩进
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// 子代理状态：有自己 pane 的以 agents() 为准，没有 pane 的只信 core 的 status。
// error 算 blocked；子代理不声明 done，它做完是回报给父母，父母的 done 才是消息。
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status ?? "idle";
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// 肖像：配到职业就画肖像图；没配到退回程序图标（单色用 svg、图片用 image），都没有就留空。
// 以每个 agent 自己的 address 当作缓存 key，彼此与各状态互不影响。
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

// ── 像素铭牌零件 ───────────────────────────────────────────────────────────
const STATUS = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };

// 状态扣的实底配色：用不透明的深色截断背后的粗框，形成嵌槽像素卡扣。
const STATUS_SKIN = {
  working: { bg: "#0e2238fa", border: "#8ccaffdd", text: "#d8eeff" },
  blocked: { bg: "#241708f8", border: "#ffb547ee", text: "#ffd080" },
  done: { bg: "#0d1d18f5", border: "#7fd8a899", text: "#9ae6be" },
  idle: { bg: "#0d131cf0", border: "#5d687866", text: "#7c8a9e" },
};

// 满版矩形路径：paint_path 只吃 Path，渐变、网点与斜纹都靠它。
const rectPath = () =>
  PathBuilder.fill()
    .move_to("0%", "0%")
    .line_to("100%", "0%")
    .line_to("100%", "100%")
    .line_to("0%", "100%")
    .close()
    .build();

const hex8 = (c, a) => (typeof c === "string" && c.startsWith("#") ? `${c.slice(0, 7)}${a}` : c);

// 4 角像素块/阶梯小点（每个组件各自 2x2px）
function cornerPixels(color, inset = 1, size = 2) {
  return [
    div().absolute().left(inset).top(inset).size(size).bg(color),
    div().absolute().right(inset).top(inset).size(size).bg(color),
    div().absolute().left(inset).bottom(inset).size(size).bg(color),
    div().absolute().right(inset).bottom(inset).size(size).bg(color),
  ];
}

// CLI 外框：全流派像素化（rounded(0) + 阶梯角点/L角 + 1px 内边高光）。
function frameLook(skin, si) {
  const style = skin.style;
  const { border: frameBorder, cabinInset } = cliFrame(style);
  const deco = [];
  let borderColor = "#00000000";
  if (style === "ring") {
    borderColor = skin.ink;
    const g = skin.ring;
    deco.push(
      div()
        .absolute()
        .inset_0()
        .rounded(0)
        .overflow_hidden()
        .opacity(skin.brightness[si])
        .child(
          window
            .paint_path(
              rectPath(),
              Background.linear_gradient(
                g.angle,
                Background.stop(g.from, 0),
                Background.stop(g.to, 1),
              ).color_space("oklab"),
            )
            .absolute()
            .top(0)
            .left(0)
            .size_full(),
        ),
    );
    deco.push(
      div()
        .absolute()
        .inset(1)
        .rounded(0)
        .border(1)
        .border_color(skin.innerLine[si]),
    );
  } else if (style === "dashed") {
    const c = skin.corner[si];
    deco.push(
      div()
        .absolute()
        .inset(1)
        .rounded(0)
        .border(1)
        .border_dashed()
        .border_color(skin.dashed[si]),
    );
    // 4 角 8 个 div 拼 2px L 角：12x2 + 2x10 + 角点像素钉
    const bar = (pos) => {
      let el = div().absolute().bg(c).w(pos.w).h(pos.h);
      if (pos.left !== undefined) el = el.left(pos.left);
      if (pos.right !== undefined) el = el.right(pos.right);
      if (pos.top !== undefined) el = el.top(pos.top);
      if (pos.bottom !== undefined) el = el.bottom(pos.bottom);
      return el;
    };
    deco.push(
      bar({ left: 1, top: 1, w: 12, h: 2 }),
      bar({ left: 1, top: 1, w: 2, h: 10 }),
      bar({ right: 1, top: 1, w: 12, h: 2 }),
      bar({ right: 1, top: 1, w: 2, h: 10 }),
      bar({ left: 1, bottom: 1, w: 12, h: 2 }),
      bar({ left: 1, bottom: 1, w: 2, h: 10 }),
      bar({ right: 1, bottom: 1, w: 12, h: 2 }),
      bar({ right: 1, bottom: 1, w: 2, h: 10 }),
      ...cornerPixels(skin.ink, 0, 1),
    );
  } else if (style === "double") {
    borderColor = skin.outer[si];
  } else if (style === "ornate" || style === "solid") {
    borderColor = skin.outer[si];
  } else if (style === "hairline") {
    borderColor = skin.line[si];
  }
  return { frameBorder, cabinInset, borderColor, deco };
}

// 左脊柱（CLI 体系）：AGY 是三段棱镜刻度，其余是通高细脊；noSpine 流派留白。
function spineNode(skin, si) {
  if (skin.noSpine || !skin.spine) return null;
  const sp = skin.spine;
  if (sp.kind === "segments") {
    return v_flex()
      .absolute()
      .left(3)
      .top(8)
      .bottom(8)
      .w(2)
      .gap(4)
      .children([0, 1, 2].map((i) => div().flex_1().w_full().bg(`${sp.colors[i % 2]}${sp.state[si]}`)));
  }
  return div().absolute().left(3).top(8).bottom(8).w(2).bg(sp.colors[si]);
}

// 立绘正后方的极淡模型背衬光（GLM 黑长直加浓到 22%）。
function modelBacking(primary, strong) {
  return div()
    .absolute()
    .right(0)
    .top(0)
    .w(88)
    .h_full()
    .child(
      window
        .paint_path(
          rectPath(),
          Background.linear_gradient(
            270,
            Background.stop(hex8(primary, strong ? "38" : "1f"), 0),
            Background.stop(hex8(primary, "00"), 1),
          ).color_space("oklab"),
        )
        .absolute()
        .top(0)
        .left(0)
        .size_full(),
    );
}

// 两段式左向遮罩的第二段：x=96..180（前 16px 实色接 68px 柔和羽化），确保 160px 模型名尾部不被亮立绘吞字。
function fadeLayer(plate, angle, left = 96) {
  return div()
    .absolute()
    .left(left)
    .top(0)
    .w(84)
    .h_full()
    .overflow_hidden()
    .child(div().absolute().left(0).top(0).w(16).h_full().bg(plate))
    .child(
      div()
        .absolute()
        .left(16)
        .top(0)
        .w(68)
        .h_full()
        .child(
          window
            .paint_path(
              rectPath(),
              Background.linear_gradient(
                angle,
                Background.stop(hex8(plate, "ff"), 0),
                Background.stop(hex8(plate, "00"), 1),
              ).color_space("oklab"),
            )
            .absolute()
            .top(0)
            .left(0)
            .size_full(),
        ),
    );
}

// 未知模型时的右侧 112x90 默认槽：极淡背光 + 低不透明度 Pixel Agent 标志 + 像素角点，消除纯黑死洞。
function unknownArtSlot() {
  return div()
    .absolute()
    .right(0)
    .top(0)
    .w(ART_W)
    .h(ART_H)
    .overflow_hidden()
    .child(
      div()
        .size_full()
        .relative()
        .flex()
        .items_center()
        .justify_center()
        .child(
          window
            .paint_path(
              rectPath(),
              Background.linear_gradient(
                270,
                Background.stop("#8ccaff14", 0),
                Background.stop("#8ccaff00", 1),
              ).color_space("oklab"),
            )
            .absolute()
            .top(0)
            .left(0)
            .size_full(),
        )
        .children(cornerPixels("#8ccaff28", 6, 2))
        .child(image("mods/gugugaga-agents/art/logo-agent.svg").size(32).opacity(0.16)),
    );
}

// Agent 扣：精致克制 h=22、16x16 像素 SVG + 舒适留白 + Cascadia Mono 加粗大写 CLI 名。
function agentBadge(info, _t, focused, skin, iconOnly = false) {
  const color = info.color ?? skin.accent;
  const mark = info.tint
    ? svg(info.logo).size(16).flex_none().text_color(color)
    : image(info.logo).size(16).flex_none();
  const label = String(info.short || info.text).trim().toUpperCase();
  return div()
    .relative()
    .flex_none()
    .pb(1)
    .child(div().absolute().left(1).right(0).bottom(0).h(1).bg("#02050aa8"))
    .child(
      h_flex()
        .relative()
        .h(22)
        .px(iconOnly ? 3 : 6)
        .gap(5)
        .items_center()
        .rounded(0)
        .max_w(iconOnly ? 22 : 124)
        .bg("#0b111cf5")
        .border(1)
        .border_color(hex8(color, focused ? "dd" : "88"))
        // 窄到只剩 Logo 扣时，名字改挂 tooltip。
        .when(iconOnly, (el) => el.tooltip(label))
        .child(
          div()
            .min_w(0)
            .flex()
            .items_center()
            .gap(5)
            .child(mark)
            .when(!iconOnly, (el) =>
              el.child(
                div()
                  .min_w(0)
                  .truncate()
                  .font_family(MONO_FONT)
                  .font_bold()
                  .text_size(10.5)
                  .text_color(color)
                  .child(label),
              ),
            ),
        ),
    );
}

// 状态记号：卡片徽章与子代理列共用同一组像素字形。
function statusMark(status, statusColor) {
  return status === "working"
    ? div().flex_none().text_size(9).text_color(statusColor).frames(["▘", "▝", "▗", "▖"], 140)
    : status === "blocked"
      ? div()
          .w(7)
          .flex()
          .items_center()
          .justify_center()
          .font_bold()
          .text_size(9.5)
          .text_color(statusColor)
          .loop("opacity", { from: 0.35, to: 1.0, period: 900, easing: "ease-in-out" })
          .child("!")
      : div().flex_none().text_size(9).text_color(statusColor).child(status === "done" ? "✓" : "▪");
}

// 右上状态扣：克制精炼 h=19 + rounded(0) + Cascadia Mono 9px。
function statusBadge(status, t, iconOnly = false) {
  const skin = STATUS_SKIN[status] ?? STATUS_SKIN.idle;
  const label = STATUS[status] ?? String(status).toUpperCase();
  const icon =
    status === "working"
      ? div()
          .w(18)
          .flex_none()
          .font_family(MONO_FONT)
          .text_size(8.5)
          .text_color(skin.text)
          .frames(["▁▂▃", "▂▃▅", "▃▅▇", "▅▇▅", "▇▅▃", "▅▃▂", "▃▂▁", "▂▁▂"], 130)
      : status === "blocked"
        ? div()
            .size(11)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(0)
            .bg(t.blocked)
            .font_family(MONO_FONT)
            .text_size(8.5)
            .font_bold()
            .text_color("#0b1018")
            .loop("opacity", { from: 0.4, to: 1.0, period: 900, easing: "ease-in-out" })
            .child("!")
        : status === "done"
          ? div()
              .size(11)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(0)
              .bg("#7fd8a828")
              .font_family(MONO_FONT)
              .text_size(8.5)
              .text_color("#7fd8a8")
              .child("✓")
          : div().flex_none().text_size(8.5).text_color("#6b7686").child("▪");
  return div()
    .relative()
    .flex_none()
    .pb(1)
    .child(div().absolute().left(1).right(0).bottom(0).h(1).bg("#02050aa8"))
    .child(
      h_flex()
        .relative()
        .h(19)
        .px(iconOnly ? 2 : 5)
        .gap(4)
        .items_center()
        .rounded(0)
        .bg(skin.bg)
        .border(1)
        .border_color(skin.border)
        .child(icon)
        .when(!iconOnly, (el) =>
          el.child(
            div()
              .flex_none()
              .font_family(MONO_FONT)
              .text_size(9)
              .when(status === "working" || status === "blocked", (e) => e.font_semibold())
              .text_color(skin.text)
              .child(label),
          ),
        ),
    );
}

// 主角模型横幅（w=160, h=22）：左 2px primary 实色竖条 + 通透柔和渐变 + 14x14 厂家 Logo + 亮白模型名。
function modelBanner(family, model, rawModel, fallbackLabel, t, width = 160) {
  const primary = family.primary;
  const label = model || fallbackLabel;
  return div()
    .relative()
    .w(width)
    .h(22)
    .rounded(0)
    .overflow_hidden()
    .child(
      window
        .paint_path(
          rectPath(),
          Background.linear_gradient(
            90,
            Background.stop(hex8(primary, "2e"), 0),
            Background.stop(hex8(primary, "00"), 1),
          ).color_space("oklab"),
        )
        .absolute()
        .top(0)
        .left(0)
        .size_full(),
    )
    .child(
      window
        .paint_path(
          rectPath(),
          Background.linear_gradient(
            90,
            Background.stop(hex8(primary, "22"), 0),
            Background.stop(hex8(primary, "00"), 1),
          ).color_space("oklab"),
        )
        .absolute()
        .left(2)
        .right(0)
        .top(0)
        .h(1),
    )
    .child(
      window
        .paint_path(
          rectPath(),
          Background.linear_gradient(
            90,
            Background.stop(hex8(primary, "22"), 0),
            Background.stop(hex8(primary, "00"), 1),
          ).color_space("oklab"),
        )
        .absolute()
        .left(2)
        .right(0)
        .bottom(0)
        .h(1),
    )
    .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(primary))
    .child(
      h_flex()
        .relative()
        .size_full()
        .pl(6)
        .pr(4)
        .gap(5)
        .items_center()
        .child(image(family.vendorLogo).size(14).flex_none())
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .font_semibold()
            .text_size(11.5)
            .text_color(model ? "#f0f6ff" : t.dim)
            .when(Boolean(rawModel), (el) => el.tooltip(String(rawModel)))
            .child(label),
        ),
    );
}

// 副信息 Effort + 可选上下文副标（h=14, max_w=150）：3x4 像素点 + 低饱和等宽字 + 自订会话名。
function effortBar(effort, primary, contextTag, maxW = 150) {
  const spec = effortSpec(effort);
  if (!spec && !contextTag) return null;
  return h_flex()
    .h(14)
    .max_w(maxW)
    .gap(6)
    .items_center()
    .when(Boolean(spec), (el) =>
      el.child(
        h_flex()
          .flex_none()
          .gap(5)
          .items_center()
          .child(
            h_flex()
              .gap(2)
              .items_center()
              .children(
                spec.cells.map((lit) =>
                  div()
                    .w(3)
                    .h(4)
                    .rounded(0)
                    .bg(lit ? hex8(primary, "cc") : "#ffffff18"),
                ),
              ),
          )
          .child(
            div()
              .font_family(MONO_FONT)
              .text_size(8.5)
              .text_color(mixHex("#8b99ad", primary, 0.35))
              .child(spec.label.toLowerCase()),
          ),
      ),
    )
    .when(Boolean(contextTag), (el) =>
      el.child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .font_family(MONO_FONT)
          .text_size(8.5)
          .text_color("#7f91a8")
          .child(spec ? `· ${contextTag}` : contextTag),
      ),
    );
}

// 底边齐平方形挖槽：bottom 严格对齐 PLATE_BOTTOM（绝不下凸破框），上/左/右 1px 像素边，底边敞口遮平底框线。
function spaceNotch(a, places, spaceName, borderColor, notchW = NOTCH_W) {
  return div()
    .relative()
    .w(notchW)
    .h(NOTCH_H)
    .rounded(0)
    .bg("#0b1018")
    .child(div().absolute().left(0).right(0).top(0).h(1).bg(borderColor))
    .child(div().absolute().left(0).top(0).bottom(0).w(1).bg(borderColor))
    .child(div().absolute().right(0).top(0).bottom(0).w(1).bg(borderColor))
    .child(
      h_flex()
        .relative()
        .size_full()
        .px(5)
        .gap(5)
        .items_center()
        .child(image(spacePlaceArt(a.space_name, places)).size(14).flex_none())
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .font_family(MONO_FONT)
            .text_size(9.5)
            .text_color("#c4d3e6")
            .child(spaceName),
        ),
    );
}

// Working 底槽 + 深底衬垫 + 亮冰蓝扫描像素块（衔接于 Space 挖槽右侧 x=152..right-1，对齐底边 1px 外框）。
function workingTrack(startLeft, trackW = 88) {
  // 扫描块宽 28，动画区间随可用 trackW 收敛，任何宽度都不会冲出底槽。
  const travel = Math.max(0, trackW - 28);
  return div()
    .absolute()
    .left(startLeft)
    .right(1)
    .bottom(1)
    .h(2)
    .overflow_hidden()
    .bg("#070c14d8")
    .child(div().absolute().inset_0().bg("#8ccaff26"))
    .child(
      h_flex()
        .absolute()
        .left(0)
        .bottom(0)
        .w(28)
        .h(2)
        .gap(3)
        .loop("left", { from: 0, to: travel, period: 1600, easing: "ease-in-out" })
        .child(div().flex_1().h(2).rounded(0).bg("#8ccaffee"))
        .child(div().flex_1().h(2).rounded(0).bg("#8ccaffee"))
        .child(div().flex_1().h(2).rounded(0).bg("#8ccaffee")),
    );
}

// Blocked 底槽的琥珀斜纹（衔接于 Space 挖槽右侧 x=152..right-1）。
function blockedSlash(startLeft) {
  return div()
    .absolute()
    .left(startLeft)
    .right(1)
    .bottom(1)
    .h(3)
    .child(
      window
        .paint_path(rectPath(), Background.pattern_slash("#ffb54777", 4, 8))
        .absolute()
        .top(0)
        .left(0)
        .size_full(),
    );
}

export default class Traveler extends View {
  init(_props, cx) {
    this.jobs = {};
    this.places = {};
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
    // on_size_change 回报的是缩放后像素（zoom 1.2 时 320 → 379），换算回 layout 单位才对得上 px。
    this.blockW = 0;
    this.hovered = null;
    this.folded = new Set(); // 折起来的子代理：address
    this.listed = new Map(); // address -> agents() 的状态（有 pane 的子代理用这个）
    this.focusedAgent = null;
    // Drag-to-reorder: pressed/over are top-level indexes in the list currently drawn.
    this.pressed = null;
    this.over = null;
    this.shownAddrs = [];
    this.loadJobs(cx);
    this.loadPlaces(cx);
    this.loadPools(cx);
    this.watchPools(cx);
    this.load(cx);
    this.loadRemote(cx);
    this.loadScreenModels(cx, true);
    this.watch(cx);
    // 数据是数字，最多 30 秒看一次就够；也让「旧」标记自己出现，顺便重试监听。
    cx.timer.every(30000, (cx) => {
      this.loadPools(cx);
      this.load(cx);
      this.loadScreenModels(cx, true);
      this.watch(cx);
      // 远程每 60 秒读一次，跟 statusLine 的更新间隔一样；远程文件夹不能监听。
      if (++this.tick % 2 === 0) this.loadRemote(cx);
    });
  }

  // 动态扫描 art/gugugaga、sprites/gugugaga/{r,w,b} 与 art/models/<family>，手动增删文件时自动同步清单。
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
    const imgExts = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
    cx.spawn(async (cx) => {
      const [portrait, rest, working, blocked, ...modelScans] = await Promise.all([
        scan("mods/gugugaga-agents/art/gugugaga", imgExts),
        scan("mods/gugugaga-agents/sprites/gugugaga/r", [".gif", ".png", ".webp"]),
        scan("mods/gugugaga-agents/sprites/gugugaga/w", [".gif", ".png", ".webp"]),
        scan("mods/gugugaga-agents/sprites/gugugaga/b", [".gif", ".png", ".webp"]),
        ...MODEL_POOL_KEYS.map((k) => scan(`mods/gugugaga-agents/art/models/${k}`, imgExts)),
      ]);
      const next = {};
      if (portrait) next.portrait = portrait;
      if (rest) next.rest = rest;
      if (working) next.working = working;
      if (blocked) next.blocked = blocked;
      const nextModels = {};
      MODEL_POOL_KEYS.forEach((k, i) => {
        if (modelScans[i]) nextModels[k] = modelScans[i];
      });
      const sig = JSON.stringify({ gugugaga: next, models: nextModels });
      if ((Object.keys(next).length > 0 || Object.keys(nextModels).length > 0) && sig !== this.poolSig) {
        this.poolSig = sig;
        setGugugagaPools(next);
        setModelPools(nextModels);
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
      ...MODEL_POOL_KEYS.map((k) => `${HOME}/mods/gugugaga-agents/art/models/${k}`),
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
  // Fallback：当没有 session 缓存档时，从 terminal 画面尾端解析当前模型与 effort。
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

  // 监听缓存文件夹：有变更就重读。文件夹不存在或不被允许时结束循环，
  // 交给上面的计时器每 30 秒重试，不会变成紧循环。
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
        // 立刻回来又没有任何变更，代表监听没真的生效，也别让它空转。
        quick = Date.now() - started < 500 && (changed ?? []).length === 0 ? quick + 1 : 0;
        if (quick >= 3) break;
        this.load(cx);
      }
      this.watching = false;
    });
  }

  loadPlaces(cx) {
    // 与 gugugaga-spaces 共用 places.json；文件不存在就用名称哈希配建筑。
    cx.spawn(async (cx) => {
      const text = await readTextFile(PLACES_FILE).catch(() => null);
      let places = {};
      try {
        const parsed = JSON.parse(text);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) places = parsed;
      } catch {
        places = {};
      }
      this.places = places;
      cx.notify();
    });
  }

  // 保存的顺序：address 数组。认不得的（新 agent）排在已知的最后，彼此照原顺序。
  savedOrder() {
    try {
      const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
      return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  applyOrder(list) {
    const saved = this.savedOrder();
    if (saved.length === 0) return list;
    const rank = new Map(saved.map((addr, i) => [addr, i]));
    return list
      .map((a, i) => ({ a, i }))
      .sort((x, y) => {
        const rx = rank.has(x.a.address) ? rank.get(x.a.address) : Number.POSITIVE_INFINITY;
        const ry = rank.has(y.a.address) ? rank.get(y.a.address) : Number.POSITIVE_INFINITY;
        return rx === ry ? x.i - y.i : rx - ry;
      })
      .map((o) => o.a);
  }

  moveCard(from, to, cx) {
    const addrs = this.shownAddrs.slice();
    if (from < 0 || to < 0 || from >= addrs.length || to >= addrs.length) return;
    const [moved] = addrs.splice(from, 1);
    addrs.splice(to, 0, moved);
    localStorage.setItem(ORDER_KEY, JSON.stringify(addrs));
    setAgentOrder(addrs);
    cx.notify();
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

  // 每个本机 agent 读自己那份缓存；远程的由 loadRemote 读。
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

  // 远程 agent 读它那台的缓存档（通过 Herdr 原有的连接，不执行指令）；连不上就是 null，画面显示「—」。
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

  // parent address -> 依模型顺序的 live 子终端（terminals() 的 parent 字段）。
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

  // 深度优先列出 addr 的子代理。lead[d] 表示第 d 层祖先还有下一个兄弟，
  // 所以那一层要补一条连到下一个的垂直树干；last 是目前这列的最后一个。
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

  // 把 top-level 卡片、子代理列与接缝树干排成 y 座标。
  // 所有卡片同一个展示高度，立绘一律靠左，不再交错；子代理列接在父母卡片下方。
  stackLayout(list, kids) {
    const cards = [];
    const subs = [];
    const stubs = [];
    let y = 0;
    let bottom = 0;
    list.forEach((a, i) => {
      const children = this.subtree(kids, a.address);
      const open = children.length > 0 && !this.folded.has(a.address);
      const start = y;
      // 最紧急的子代理决定徽章颜色（卡片本身只看自己的状态）。
      const urgent = children.reduce((best, s) => {
        const st = kidStatus(s.k, this.listed);
        return (RANK[st] ?? 0) > (RANK[best] ?? 0) ? st : best;
      }, null);
      cards.push({ a, i, y: start, count: children.length, open, urgent });
      y = start + CARD_STEP;
      bottom = start + CARD_H;
      if (!open) return;
      // 从下方无框 #Tab 标签正下方接第一列：由 stub 补齐到 first，列与列之间由各列的树干补。
      const first = start + CARD_H + SQUAD_GAP;
      stubs.push({ x: TRUNK_X, y: start + TAB_ROW_TOP + TAB_ROW_H + 2, h: CARD_H - (TAB_ROW_TOP + TAB_ROW_H + 2) + SQUAD_GAP });
      children.forEach((s, n) => subs.push({ ...s, trunkX: TRUNK_X, y: first + n * (SQUAD_H + SQUAD_GAP) }));
      bottom = first + (children.length - 1) * (SQUAD_H + SQUAD_GAP) + SQUAD_H;
      y = bottom + SQUAD_GAP + 2;
    });
    return { cards, subs, stubs, totalH: bottom > 0 ? bottom + 4 : 0 };
  }

  // 卡片内的小队徽章：h=19 + rounded(0) + Cascadia Mono + 硬像素边框。
  squadChip(a, card, t) {
    const color = t[card.urgent] ?? t.dim;
    const open = card.open;
    return div()
      .relative()
      .flex_none()
      .pb(1)
      .child(div().absolute().left(1).right(0).bottom(0).h(1).bg("#02050aa8"))
      .child(
        h_flex()
          .id(`squad-${a.address}`)
          .relative()
          .h(19)
          .px(5)
          .gap(3)
          .items_center()
          .rounded(0)
          .bg("#0b111cf5")
          .border(1)
          .border_color(hex8(color, "88"))
          .cursor_pointer()
          // 不让折叠点击被外层卡片的拖拽/聚焦吃掉。
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (open) this.folded.add(a.address);
            else this.folded.delete(a.address);
            cx.notify();
          })
          .child(div().flex_none().font_family(MONO_FONT).text_size(8.5).text_color(color).child(open ? "▾" : "▸"))
          .child(div().flex_none().font_family(MONO_FONT).text_size(9).font_bold().text_color(color).child(String(card.count))),
      );
  }

  // 子代理列：像素 outliner 的树干／横枝／方块节点，右侧接一行窄信息（不用立绘，没有新 GIF）。
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
    // 祖先层：贯穿这一列并多走 SQUAD_GAP，接上下一个兄弟。
    for (let d = 0; d < s.lead.length; d++) {
      if (!s.lead[d]) continue;
      gutter.push(div().absolute().left(x(d)).top(0).w(2).h(SQUAD_H + SQUAD_GAP).bg(trunk));
    }
    // 自己这层：非最后一个走满，最后一个只走到横枝；横枝与节点对齐 y=8。
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

  cardPlate(a, t, card) {
    const cache = this.cache[a.address] ?? this.remote[a.address] ?? null;
    const screen = this.screenModels[a.address] ?? null;
    const isHot = this.hovered === a.address;
    // 多个 agent 可能同时回报 focused：只认这一个，否则一整排卡片都会发亮。
    const focused = a.address === this.focusedAgent;
    const info = resolveAppInfo(a);
    const skin = cliSkin(info.cli);
    const rawModel = cache?.model ?? screen?.model ?? null;
    const family = modelFamily(rawModel, info.key);
    const model = modelLabel(rawModel);
    const effort = cache?.effort ?? screen?.effort ?? null;
    const spaceName = a.space_name || a.address;
    const tabRaw = String(a.tab_name || "").trim();
    const tabLabel = tabRaw || spaceName;
    const hashTab = tabLabel.startsWith("#") ? tabLabel : `#${tabLabel}`;
    // 四态：blocked > focused > hovered > default；si 只给 CLI 色表采样。
    const state =
      a.status === "blocked" ? "blocked" : focused ? "focused" : isHot ? "hovered" : "default";
    const si = state === "focused" ? 2 : state === "hovered" ? 1 : 0;
    const look = frameLook(skin, si);
    // ── 四档响应式：侧栏宽度决定铭牌宽度与收纳层级 ─────────────────────
    // panelW 由 on_size_change 量得（已换算回 layout 单位）；首帧还没有量测值时退回 240 的完整态。
    const panelW = this.blockW ?? 0;
    const measured = panelW > 0;
    const plateW = measured
      ? Math.max(80, Math.min(320, Math.round(panelW - 16 - PLATE_X)))
      : PLATE_W;
    const tier = !measured || panelW >= 272 ? "full" : panelW >= 228 ? "noArt" : "minimal";
    const showArt = tier === "full";
    // 立绘左缘：full 态的羽化要贴着立绘左缘走（plateW 240 时正好 96）。
    const fadeLeft = Math.max(40, plateW - 144);
    const notchW = Math.max(56, Math.min(NOTCH_W, plateW - 18));
    const trackStart = NOTCH_LEFT_IN_PLATE + notchW;
    const trackW = plateW - trackStart - 1;
    const trackFits = trackW >= 24;
    const bannerW = Math.max(60, Math.min(160, plateW - 16));
    const effortMaxW = Math.max(60, plateW - 18);
    // 防碰撞降级：铭牌窄到放不下文本时，把扣切成纯图标（名字改挂 tooltip）。
    const statusIconOnly = plateW < 192;
    const agentIconOnly = plateW < 156 || (card.count > 0 && plateW < 176);
    const resolvedArt = modelArtForFamily(family.key, a.address);
    const art = showArt ? resolvedArt : null;
    // noArt 态只留右侧极淡背衬光，立绘 / 默认槽 / 羽化一律干净隐藏。
    const artBacking = Boolean(resolvedArt) && tier !== "minimal";
    const isDimIdle = a.status === "idle" && !focused && !isHot;
    const artOpacity =
      state === "blocked" ? 0.92 : state === "focused" ? 0.98 : state === "hovered" ? 0.94 : isDimIdle ? 0.48 : 0.84;
    const mist =
      state === "blocked" ? "#ffb54710" : state === "focused" ? "#8ccaff0e" : state === "hovered" ? "#ffffff08" : null;
    // 底部阶梯像素托架（━━┓┗━━）与无框 #Tab 配色
    const railColor =
      state === "blocked"
        ? "#ffb547"
        : state === "focused"
          ? "#8ccaff"
          : state === "hovered"
            ? "#69a6e0"
            : mixHex(skin.plate, skin.accent, 0.42);
    const lStep = {
      line: railColor,
      hi: state === "blocked" ? "#ffe0a366" : state === "focused" ? "#e0f2ff88" : "#ffffff24",
      fg:
        state === "blocked"
          ? "#ffd080"
          : state === "focused"
            ? "#eef4fc"
            : state === "hovered"
              ? "#c8d6e8"
              : "#8f9fb5",
      arrow: state === "blocked" ? "#ffb547" : "#8ccaff",
    };
    const dropLine = this.pressed !== null && this.over === card.i && this.pressed !== card.i;
    const spine = spineNode(skin, si);
    const fallbackLabel = model ? "ready" : cache?.name || "ready";
    const contextTag = model
      ? contextLabel(cache?.name, a.tab_name, { model, rawModel, spaceName })
      : contextLabel(null, a.tab_name, { model: fallbackLabel, spaceName });
    const effortRow = effortBar(effort, family.primary, contextTag, effortMaxW);
    const unifiedOutline =
      state === "blocked" ? "#ffb547ee" : state === "focused" ? "#8ccaffa8" : null;
    const skinEdge =
      skin.outer?.[si] ?? skin.line?.[si] ?? skin.innerLine?.[si] ?? skin.dashed?.[si] ?? mixHex(skin.plate, skin.accent, 0.42);
    const notchBorder =
      state === "blocked" ? "#ffb547ee" : state === "focused" ? "#8ccaff" : state === "hovered" ? "#8ccaff88" : skinEdge;

    return div()
      .id(`traveler-${a.address}`)
      .absolute()
      .left(0)
      .right(0)
      .top(card.y)
      .h(CARD_H)
      .rounded(0)
      .when(this.pressed === card.i, (el) => el.opacity(0.5))
      .cursor_pointer()
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      // 拖拽重排：按下记住来源，移到哪张卡就把 over 指到哪里，放开才决定是拖拽还是点击。
      .on_mouse_down("left", () => {
        this.pressed = card.i;
        this.over = card.i;
      })
      .on_mouse_move((_e, cx) => {
        if (this.pressed !== null && this.over !== card.i) {
          this.over = card.i;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const to = this.over;
        this.pressed = null;
        this.over = null;
        // from === null：这一下不是从卡片上按下的（例如折叠徽章自己吃掉了按下事件），不要误聚焦。
        if (from !== null && to !== null && from !== to) this.moveCard(from, to, cx);
        else if (from !== null) run("agent.focus", { terminal: a.address });
        cx.notify();
      })
      // 右侧 240x96 CLI 特色外框（外圈 → 装饰 → 内舱，干净极夜底板，零网点噪声与黑泥底影）。
      .child(
        div()
          .absolute()
          .left(PLATE_X)
          .top(PLATE_TOP)
          .w(plateW)
          .h(PLATE_H)
          .rounded(0)
          .bg(skin.plate)
          .border(look.frameBorder)
          .border_color(look.borderColor)
          .overflow_hidden()
          .children(look.deco)
          .child(
            // 内舱：inset 依流派查表，确保立绘 112x90 槽位精准对齐。
            div()
              .absolute()
              .inset(look.cabinInset)
              .rounded(0)
              .bg(skin.plate)
              .overflow_hidden()
              // 立绘微背衬光（Model 体系）
              .when(artBacking, (el) => el.child(modelBacking(family.primary, family.moon)))
              // 右贴半身立绘（图档顶部已留安全边距，top(0) 完整保留胸口领结，非聚焦 IDLE 叠统一深冰夜压暗幕）
              .when(Boolean(art), (el) =>
                el.child(
                  div()
                    .absolute()
                    .right(0)
                    .top(0)
                    .w(ART_W)
                    .h(ART_H)
                    .overflow_hidden()
                    .child(image(art).absolute().left(0).top(0).w(ART_W).h(ART_H).opacity(artOpacity))
                    .when(isDimIdle, (slot) => slot.child(div().absolute().inset_0().bg("#080e185c")))
                    .child(
                      div()
                        .absolute()
                        .left(0)
                        .right(0)
                        .top(0)
                        .h(14)
                        .child(
                          window
                            .paint_path(
                              rectPath(),
                              Background.linear_gradient(
                                180,
                                Background.stop(hex8(skin.plate, "88"), 0),
                                Background.stop(hex8(skin.plate, "00"), 1),
                              ).color_space("oklab"),
                            )
                            .absolute()
                            .top(0)
                            .left(0)
                            .size_full(),
                        ),
                    ),
                ),
              )
              .when(showArt && !art, (el) => el.child(unknownArtSlot()))
              // 左向干净羽化过渡：销点跟着立绘左缘，换宽度也不错位
              .when(showArt && Boolean(art), (el) => el.child(fadeLayer(skin.plate, 90, fadeLeft)))
              // 状态薄雾在羽化之上、文本之下
              .when(Boolean(mist), (el) => el.child(div().absolute().inset_0().bg(mist)))
              // 内舱细线与克制像素角饰
              .when(skin.style === "double" || skin.style === "ornate", (el) =>
                el.child(
                  div()
                    .absolute()
                    .inset_0()
                    .rounded(0)
                    .border(1)
                    .border_color((skin.inner || skin.line)[si]),
                ),
              )
              .when(Boolean(skin.cornerDots), (el) => el.children(cornerPixels(skin.outer[si], 2, 2)))
              .when(Boolean(skin.pixelCorners), (el) => el.children(cornerPixels(skin.pixelCorners[si], 1, 2)))
              .when(Boolean(skin.cornerMotif), (el) =>
                el.children(
                  [
                    { left: 1, top: 1 },
                    { right: 1, top: 1 },
                    { left: 1, bottom: 1 },
                    { right: 1, bottom: 1 },
                  ].map((pos) => {
                    let blk = div()
                      .absolute()
                      .size(4)
                      .bg(skin.inner[si])
                      .child(div().absolute().left(1).top(1).size(2).bg(skin.plate));
                    if (pos.left !== undefined) blk = blk.left(pos.left);
                    if (pos.right !== undefined) blk = blk.right(pos.right);
                    if (pos.top !== undefined) blk = blk.top(pos.top);
                    if (pos.bottom !== undefined) blk = blk.bottom(pos.bottom);
                    return blk;
                  }),
                ),
              )
              // 侧脊 / 品牌实条 / 4 角像素钉
              .when(Boolean(spine), (el) => el.child(spine))
              .when(Boolean(skin.leftBar), (el) =>
                el.child(div().absolute().left(0).top(0).bottom(0).w(4).bg(skin.leftBar[si])),
              )
              .when(Boolean(skin.nails), (el) => el.children(cornerPixels(skin.outer[si], 3, 2)))
              // 主从分明内舱排版：主角模型横幅（left 10, top 18, w 160）+ 副信息 Effort（left 10, top 44, h 14）。
              .child(
                div()
                  .absolute()
                  .left(10)
                  .top(18)
                  .child(modelBanner(family, model, rawModel, fallbackLabel, t, bannerW)),
              )
              .when(Boolean(effortRow), (el) =>
                el.child(div().absolute().left(10).top(44).child(effortRow)),
              )
              // CLI 内角小徽记：Claude ✻ / Qwen ✧ / Kimi ☾ / Gemini 双星。
              .when(Boolean(skin.bottomRight), (el) =>
                el.child(
                  div()
                    .absolute()
                    .right(5)
                    .bottom(4)
                    .text_size(9)
                    .text_color(skin.bottomRightColor[si])
                    .child(skin.bottomRight),
                ),
              )
              .when(Boolean(skin.stars), (el) =>
                el
                  .child(div().absolute().left(5).bottom(4).text_size(9).text_color(skin.stars[0]).child("✦"))
                  .child(div().absolute().right(5).bottom(4).text_size(9).text_color(skin.stars[1]).child("✦")),
              )
              // Blocked 的琥珀呼吸警框（rounded(0)）。
              .when(a.status === "blocked", (el) =>
                el.child(
                  div()
                    .absolute()
                    .inset_0()
                    .rounded(0)
                    .border(2)
                    .border_color(t.blocked)
                    .loop("opacity", { from: 0.25, to: 0.95, period: 1100, easing: "ease-in-out" }),
                ),
              ),
          )
          // 四态底槽动效（对齐外框底边 y=106 内侧 bottom(1)，精确衔接于 Space 挖槽右侧 x=152..right-1）
          .when(a.status === "working" && trackFits, (el) => el.child(workingTrack(trackStart, trackW)))
          .when(a.status === "blocked" && trackFits, (el) => el.child(blockedSlash(trackStart)))
          .when(a.status === "done" && trackFits, (el) =>
            el.child(div().absolute().left(trackStart).right(1).bottom(1).h(2).bg("#7fd8a866")),
          )
          // 聚焦/Blocked 时点亮与底部阶梯托架+挖槽一致的外轮廓框
          .when(Boolean(unifiedOutline), (el) =>
            el.child(div().absolute().inset_0().rounded(0).border(1).border_color(unifiedOutline)),
          ),
      )
      // 名片底边齐平方形挖槽：严格底对齐 y = PLATE_BOTTOM，绝不下凸破框，底边敞口遮平底线。
      .child(
        div()
          .absolute()
          .left(PLATE_X + NOTCH_LEFT_IN_PLATE)
          .top(PLATE_BOTTOM - NOTCH_H)
          .child(spaceNotch(a, this.places, spaceName, notchBorder, notchW)),
      )
      // 底部阶梯像素托架（━━┓┗━━）：脚底托盘 (y=74, x=4..54) -> 右折下探 (x=52, y=74..107) -> 底边直连 (y=105..107, x=52..65)。
      .child(
        div()
          .absolute()
          .left(TRAY_X)
          .top(TRAY_Y)
          .w(TRAY_W)
          .h(2)
          .bg(lStep.line)
          .child(div().absolute().left(0).right(0).top(0).h(1).bg(lStep.hi)),
      )
      .child(
        div()
          .absolute()
          .left(DROP_X)
          .top(TRAY_Y)
          .w(2)
          .h(PLATE_BOTTOM - TRAY_Y)
          .bg(lStep.line),
      )
      .child(
        div()
          .absolute()
          .left(DROP_X)
          .top(PLATE_BOTTOM - 2)
          .w(PLATE_X + 1 - DROP_X)
          .h(2)
          .bg(lStep.line)
          .child(div().absolute().left(2).right(0).top(0).h(1).bg(lStep.hi)),
      )
      // 左列企鹅立绘（48x64 稳踩在 y=74 水平托盘在线）
      .child(
        div()
          .absolute()
          .left(4)
          .top(SPRITE_TOP)
          .w(SPRITE_W)
          .h(SPRITE_H)
          .child(portrait(a, this.assigned, t)),
      )
      // 托盘下方无框 # Tab 标签（y=80..100，x=4..50 窝在阶梯折线左侧，与右侧 Space 挖槽呼应）
      .child(
        h_flex()
          .absolute()
          .left(4)
          .top(TAB_ROW_TOP)
          .w(46)
          .h(TAB_ROW_H)
          .gap(2)
          .items_center()
          .justify_center()
          .tooltip(hashTab)
          .when(state === "focused" || state === "blocked", (el) =>
            el.child(
              div()
                .flex_none()
                .font_family(MONO_FONT)
                .text_size(9)
                .font_bold()
                .text_color(lStep.arrow)
                .child("▸"),
            ),
          )
          .child(
            div()
              .min_w(0)
              .truncate()
              .font_family(MONO_FONT)
              .text_size(9.5)
              .when(state === "focused" || state === "blocked", (el) => el.font_semibold())
              .text_color(lStep.fg)
              .child(hashTab),
          ),
      )
      // 骑框徽章层（在外框之后，才不会被 overflow_hidden 裁掉）。
      .child(
        div()
          .absolute()
          .left(PLATE_X)
          .top(0)
          .w(plateW)
          .h(24)
          .flex()
          .items_center()
          .justify_between()
          .child(div().ml(6).child(agentBadge(info, t, focused, skin, agentIconOnly)))
          .child(
            h_flex()
              .mr(6)
              .gap(4)
              .items_center()
              .when(card.count > 0, (el) => el.child(this.squadChip(a, card, t)))
              .child(statusBadge(a.status, t, statusIconOnly)),
          ),
      )
      // 拖拽插入线：往下拖画在目标下缘，往上拖画在目标上缘。
      .when(dropLine, (el) =>
        el.child(
          div()
            .absolute()
            .left(4)
            .right(4)
            .h(2)
            .bg(t.accent)
            .when(this.pressed < card.i, (line) => line.bottom(0))
            .when(this.pressed > card.i, (line) => line.top(0)),
        ),
      );
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
            .border_color(a.status === "blocked" ? t.blocked : a.focused ? t.accent : "#232a36")
            .rounded(0)
            .bg(a.focused ? withAlpha(t.raised, "ee") : withAlpha(t.surface, "c8"))
            .cursor_pointer()
            .on_click(() => run("agent.focus", { terminal: a.address }))
            .child(portrait(a, this.assigned, t)),
        ),
      );
  }

  // Party 标题列的快捷收缩扣：320 <-> 196 两档，直接切到「极简铭牌态」。
  foldButton(t) {
    const blockW = this.blockW ?? 0;
    const wide = blockW <= 0 || blockW >= 258;
    const target = wide ? FOLD_NARROW_PX : FOLD_WIDE_PX;
    return div()
      .id("agents-fold")
      .size(18)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(0)
      .border(1)
      .border_color(withAlpha(t.border, "99"))
      .bg(withAlpha(t.canvas, "66"))
      .cursor_pointer()
      .hover((el) => el.bg(t.hover).border_color(withAlpha(t.accent, "77")))
      .tooltip(wide ? `Sidebar ${FOLD_WIDE_PX} → ${FOLD_NARROW_PX}` : `Sidebar ${FOLD_NARROW_PX} → ${FOLD_WIDE_PX}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => run("layout.resize", { id: "sidebar", px: target }))
      // 纯像素双竖条（不依赖字体字符，避免 tofu）：亮的一侧表示当前宽度档位。
      .child(
        h_flex()
          .flex_none()
          .gap(2)
          .items_center()
          .child(div().w(3).h(9).rounded(0).bg(withAlpha(t.accent, wide ? "dd" : "44")))
          .child(div().w(3).h(9).rounded(0).bg(withAlpha(t.accent, wide ? "44" : "dd"))),
      );
  }

  render(cx) {
    const t = theme();
    const base = agents();
    this.assigned = assignJobs(tabNames(spaces(), base), this.jobs);
    // 刚出现的 agent 先补读一次缓存，不用等下一次计时器。
    const fresh = base.filter((a) => !this.seen.has(a.address));
    if (fresh.some((a) => cachePath(HOME, a.address) !== null)) this.load(cx);
    if (fresh.some((a) => remoteCachePath(a.address) !== null)) this.loadRemote(cx);
    if (base.some((a) => !((this.cache[a.address] ?? this.remote[a.address])?.model) && (!(a.address in this.screenModels) || this.lastSeq[a.address] !== a.seq))) {
      this.loadScreenModels(cx, false);
    }

    const compactRail = this.blockW > 0 && this.blockW < NARROW_PX;
    // 嵌套关系只在 terminals() 的 parent 上。nested 涵盖所有 live 子代理，不看折叠状态：
    // 折起一个父母时，子代理也不能弹出来变成另一张 top-level 卡片。
    const kids = this.childIndex(compactRail ? [] : terminals());
    const nested = new Set();
    for (const a of base) for (const s of this.subtree(kids, a.address)) nested.add(s.k.address);
    // 用户拖出来的顺序优先；没记录过的（新 agent）排在已知的后面。
    const list = this.applyOrder(base.filter((a) => a.pinned || !nested.has(a.address)));
    this.listed = new Map(base.map((a) => [a.address, a.status]));
    this.focusedAgent = base.find((a) => a.focused)?.address ?? null;
    // 折叠状态只清掉真的消失的父母；窄侧边栏没有折叠 UI，不要因此清光。
    if (!compactRail) for (const key of this.folded) if (!kids.has(key)) this.folded.delete(key);
    this.shownAddrs = list.map((a) => a.address);
    setAgentOrder(this.shownAddrs);

    const plan = compactRail ? { cards: [], subs: [], stubs: [], totalH: 0 } : this.stackLayout(list, kids);

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
          // 量到的是缩放后像素：除以 zoom 才是 layout px（zoom 1.2 时 320 → 379）。
          const z = settings()?.zoom;
          const zoom = typeof z === "number" && z > 0 ? z : 1;
          this.blockW = size.width / zoom;
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
              .pr(8)
              .gap(6)
              .items_center()
              .justify_between()
              .flex_none()
              .text_size(11)
              .text_color(t.accent)
              .child(
                h_flex()
                  .flex_none()
                  .gap(6)
                  .items_center()
                  .child(div().font_semibold().child("Party"))
                  .child(
                    h_flex()
                      .flex_none()
                      .px(4)
                      .h(15)
                      .items_center()
                      .justify_center()
                      .rounded(0)
                      .border(1)
                      .border_color(withAlpha(t.border, "66"))
                      .bg(withAlpha(t.canvas, "bb"))
                      .font_family(MONO_FONT)
                      .text_size(10)
                      .text_color(t.accent)
                      .child(`[${list.length}]`),
                  ),
              )
              .child(this.foldButton(t)),
          )
          .child(
            v_flex()
              .flex_1()
              .min_h(0)
              .px(8)
              .pb(8)
              .pt(2)
              .overflow_y_scrollbar()
              // 拖到卡片外才放开：清掉残留的拖拽状态，卡片不会一直半透明。
              .on_mouse_up("left", (_e, cx) => {
                if (this.pressed !== null || this.over !== null) {
                  this.pressed = null;
                  this.over = null;
                  cx.notify();
                }
              })
            .when(list.length > 0, (sc) =>
              sc.child(
                div()
                  .relative()
                  .w_full()
                  .h(plan.totalH)
                  .flex_none()
                  .children(plan.cards.map((c) => this.cardPlate(c.a, t, c)))
                  .children(plan.stubs.map((s) => div().absolute().left(s.x).top(s.y).w(2).h(s.h).bg(withAlpha(t.accent, "55"))))
                  .children(plan.subs.map((s) => this.subRow(s, t))),
              ),
            )
            .when(list.length === 0, (sc) =>
              sc.child(div().p(8).text_size(12).text_color(t.dim).child("No agents")),
            ),
        ),
      );
  }
}
