// 咕咕嘎嘎 Agents 卡片：把 agents() 畫成職業肖像卡片，狀態、模型與子代理樹都畫在同一張卡上。
// 讀 jobs.json 與 data/traveler/sessions 快取；沒有快取時會跑 `hc read <address> --lines 25` 抓終端尾端解析模型。
// 不連網、不讀憑證、不寫任何檔案；沒有資料就不畫那一段。
import { readdir } from "fs/promises";
import { View, Background, PathBuilder, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, hc, readTextFile, run, setAgentOrder, settings, spaces, terminals, theme, watchFolder } from "herdr";
import { assignJobs, cachePath, cliFrame, cliSkin, contextLabel, effortSpec, jobIn, mixHex, modelFamily, modelLabel, parseCache, parseTerminalModel, portraitPath, remoteCachePath, resolveAppInfo, setGugugagaPools, spacePlaceArt, spritePath, tabNames } from "./lib.js";

const HOME = appHome();
const SESSIONS_DIR = `${HOME}/data/traveler/sessions`;
const JOBS_FILE = `${HOME}/mods/gugugaga-agents/jobs.json`;
const PLACES_FILE = `${HOME}/mods/gugugaga-spaces/places.json`;
const ORDER_KEY = "agents.order";
const PIC = 48;
// Sprites are 48x64 logical pixels (3:4); rendered 1:1 so pixel art stays crisp.
const SPRITE_W = 48;
const SPRITE_H = 64;
// 展示卡：左列極簡階梯像素托架（48x64 企鵝 + ━━┓┗━━ 連入名片底邊）+ 240x96 像素銘牌（底邊齊平挖槽 Space）。
const CARD_H = 109;
const CARD_GAP = 8;
const CARD_STEP = CARD_H + CARD_GAP;
const LEFT_W = 56; // 立繪列寬
const PLATE_X = LEFT_W + 8; // 銘牌左緣 = 64
const PLATE_W = 240;
const PLATE_H = 96;
const PLATE_TOP = 11; // 騎框徽章 h22、中線騎在 y=11 的頂框上
const PLATE_BOTTOM = PLATE_TOP + PLATE_H; // 107，名片底邊絕對筆直基線
const ART_W = 112; // 立繪 @2x 224x180 -> 邏輯 112x90
const ART_H = 90;
const SPRITE_TOP = 10; // 企鵝 y=10..74，腳底穩踩在 y=74 水平托盤線上
const TRAY_X = 4;
const TRAY_W = 50; // x=4..54
const TRAY_Y = 74;
const DROP_X = 52; // x=52..54 直角下折至 y=107
const TAB_ROW_TOP = 80;
const TAB_ROW_H = 20; // y=80..100，居中於企鵝正下方 x=4..50
const NOTCH_LEFT_IN_PLATE = 10;
const NOTCH_W = 142; // 完整態挖槽寬；窄態由 plateW 收斂
const NOTCH_H = 19; // bottom 嚴格齊平 y=107，絕不下凸破框
const NARROW_PX = 160; // 窄軌門檻：與 gugugaga-spaces / gugugaga-chrome 同一個數
const FOLD_WIDE_PX = 320; // Party 收縮扣的兩檔寬度
const FOLD_NARROW_PX = 196;
const MONO_FONT = "Cascadia Mono";
const PLATE_INK = "#070b12";
const withAlpha = (c, a) => (typeof c === "string" && c.startsWith("#") ? `${c.slice(0, 7)}${a}` : c);

// ── 小隊梯（子代理）：巢狀關係只存在 terminals() 的 parent 上，agents() 沒有這個欄位。
// 對齊 gugugaga-spaces 的像素 outliner：2px 樹幹、9x2 橫枝、5px 方塊節點。
const SQUAD_H = 17; // 子代理列高
const SQUAD_GAP = 2; // 列與列之間留 2px，由樹幹補滿，接縫不會斷
const TRUNK_X = 27; // 樹幹對齊企鵝與 #Tab 正下方中心
const DEPTH_STEP = 12; // 每深一層右移
const DEPTH_MAX = 3; // 320px 側欄可以容納三層縮排
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

// ── 像素銘牌零件 ───────────────────────────────────────────────────────────
const STATUS = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };

// 狀態扣的實底配色：用不透明的深色截斷背後的粗框，形成嵌槽像素卡扣。
const STATUS_SKIN = {
  working: { bg: "#0e2238fa", border: "#8ccaffdd", text: "#d8eeff" },
  blocked: { bg: "#241708f8", border: "#ffb547ee", text: "#ffd080" },
  done: { bg: "#0d1d18f5", border: "#7fd8a899", text: "#9ae6be" },
  idle: { bg: "#0d131cf0", border: "#5d687866", text: "#7c8a9e" },
};

// 滿版矩形路徑：paint_path 只吃 Path，漸層、網點與斜紋都靠它。
const rectPath = () =>
  PathBuilder.fill()
    .move_to("0%", "0%")
    .line_to("100%", "0%")
    .line_to("100%", "100%")
    .line_to("0%", "100%")
    .close()
    .build();

const hex8 = (c, a) => (typeof c === "string" && c.startsWith("#") ? `${c.slice(0, 7)}${a}` : c);

// 4 角像素塊/階梯小點（每個元件各自 2x2px）
function cornerPixels(color, inset = 1, size = 2) {
  return [
    div().absolute().left(inset).top(inset).size(size).bg(color),
    div().absolute().right(inset).top(inset).size(size).bg(color),
    div().absolute().left(inset).bottom(inset).size(size).bg(color),
    div().absolute().right(inset).bottom(inset).size(size).bg(color),
  ];
}

// CLI 外框：全流派像素化（rounded(0) + 階梯角點/L角 + 1px 內邊高光）。
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
    // 4 角 8 个 div 拼 2px L 角：12x2 + 2x10 + 角點像素釘
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

// 左脊柱（CLI 體系）：AGY 是三段棱鏡刻度，其餘是通高細脊；noSpine 流派留白。
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

// 立繪正后方的極淡模型背襯光（GLM 黑長直加濃到 22%）。
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

// 兩段式左向遮罩的第二段：x=96..180（前 16px 實色接 68px 柔和羽化），確保 160px 模型名尾部不被亮立繪吞字。
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

// 未知模型時的右側 112x90 缺省槽：極淡背光 + 低不透明度 Pixel Agent 標誌 + 像素角點，消除純黑死洞。
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

// Agent 扣：精緻克制 h=22、16x16 像素 SVG + 舒適留白 + Cascadia Mono 加粗大寫 CLI 名。
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
        // 窄到只剩 Logo 扣時，名字改掛 tooltip。
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

// 狀態記號：卡片徽章與子代理列共用同一組像素字形。
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

// 右上狀態扣：克制精煉 h=19 + rounded(0) + Cascadia Mono 9px。
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

// 主角模型橫幅（w=160, h=22）：左 2px primary 實色豎條 + 通透柔和漸變 + 14x14 廠家 Logo + 亮白模型名。
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

// 副信息 Effort + 可選上下文副標（h=14, max_w=150）：3x4 像素點 + 低飽和等寬字 + 自訂會話名。
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

// 底邊齊平方形挖槽：bottom 嚴格對齊 PLATE_BOTTOM（絕不下凸破框），上/左/右 1px 像素邊，底邊敞口遮平底框線。
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

// Working 底槽 + 深底襯墊 + 亮冰藍掃描像素塊（銜接於 Space 挖槽右側 x=152..right-1，貼齊底邊 1px 外框）。
function workingTrack(startLeft, trackW = 88) {
  // 掃描塊寬 28，動畫區間隨可用 trackW 收斂，任何寬度都不會衝出底槽。
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

// Blocked 底槽的琥珀斜紋（銜接於 Space 挖槽右側 x=152..right-1）。
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
    // on_size_change 回報的是縮放後像素（zoom 1.2 時 320 → 379），換算回 layout 單位才對得上 px。
    this.blockW = 0;
    this.hovered = null;
    this.folded = new Set(); // 折起來的子代理：address
    this.listed = new Map(); // address -> agents() 的狀態（有 pane 的子代理用這個）
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

  loadPlaces(cx) {
    // 與 gugugaga-spaces 共用 places.json；檔案不存在就用名稱哈希配建築。
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

  // 儲存的順序：address 陣列。認不得的（新 agent）排在已知的最後，彼此照原順序。
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
  // 所有卡片同一個展示高度，立繪一律靠左，不再交錯；子代理列接在父母卡片下方。
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
      // 最緊急的子代理決定徽章顏色（卡片本身只看自己的狀態）。
      const urgent = children.reduce((best, s) => {
        const st = kidStatus(s.k, this.listed);
        return (RANK[st] ?? 0) > (RANK[best] ?? 0) ? st : best;
      }, null);
      cards.push({ a, i, y: start, count: children.length, open, urgent });
      y = start + CARD_STEP;
      bottom = start + CARD_H;
      if (!open) return;
      // 從下方無框 #Tab 標籤正下方接第一列：由 stub 補齊到 first，列與列之間由各列的樹幹補。
      const first = start + CARD_H + SQUAD_GAP;
      stubs.push({ x: TRUNK_X, y: start + TAB_ROW_TOP + TAB_ROW_H + 2, h: CARD_H - (TAB_ROW_TOP + TAB_ROW_H + 2) + SQUAD_GAP });
      children.forEach((s, n) => subs.push({ ...s, trunkX: TRUNK_X, y: first + n * (SQUAD_H + SQUAD_GAP) }));
      bottom = first + (children.length - 1) * (SQUAD_H + SQUAD_GAP) + SQUAD_H;
      y = bottom + SQUAD_GAP + 2;
    });
    return { cards, subs, stubs, totalH: bottom > 0 ? bottom + 4 : 0 };
  }

  // 卡片內的小隊徽章：h=19 + rounded(0) + Cascadia Mono + 硬像素邊框。
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
          // 不讓折疊點擊被外層卡片的拖曳/聚焦吃掉。
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

  cardPlate(a, t, card) {
    const cache = this.cache[a.address] ?? this.remote[a.address] ?? null;
    const screen = this.screenModels[a.address] ?? null;
    const isHot = this.hovered === a.address;
    // 多個 agent 可能同時回報 focused：只認這一個，否則一整排卡片都會發亮。
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
    // 四態：blocked > focused > hovered > default；si 只給 CLI 色表取樣。
    const state =
      a.status === "blocked" ? "blocked" : focused ? "focused" : isHot ? "hovered" : "default";
    const si = state === "focused" ? 2 : state === "hovered" ? 1 : 0;
    const look = frameLook(skin, si);
    // ── 四檔響應式：側欄寬度決定銘牌寬度與收納層級 ─────────────────────
    // panelW 由 on_size_change 量得（已換算回 layout 單位）；首帧还没有量測值時退回 240 的完整態。
    const panelW = this.blockW ?? 0;
    const measured = panelW > 0;
    const plateW = measured
      ? Math.max(80, Math.min(320, Math.round(panelW - 16 - PLATE_X)))
      : PLATE_W;
    const tier = !measured || panelW >= 272 ? "full" : panelW >= 228 ? "noArt" : "minimal";
    const showArt = tier === "full";
    // 立繪左緣：full 態的羽化要貼著立繪左緣走（plateW 240 時正好 96）。
    const fadeLeft = Math.max(40, plateW - 144);
    const notchW = Math.max(56, Math.min(NOTCH_W, plateW - 18));
    const trackStart = NOTCH_LEFT_IN_PLATE + notchW;
    const trackW = plateW - trackStart - 1;
    const trackFits = trackW >= 24;
    const bannerW = Math.max(60, Math.min(160, plateW - 16));
    const effortMaxW = Math.max(60, plateW - 18);
    // 防碰撞降級：銘牌窄到放不下文字時，把扣切成純圖示（名字改掛 tooltip）。
    const statusIconOnly = plateW < 192;
    const agentIconOnly = plateW < 156 || (card.count > 0 && plateW < 176);
    const art = showArt ? family.art : null;
    // noArt 態只留右側極淡背襯光，立繪 / 缺省槽 / 羽化一律乾淨隱藏。
    const artBacking = Boolean(family.art) && tier !== "minimal";
    const isDimIdle = a.status === "idle" && !focused && !isHot;
    const artOpacity =
      state === "blocked" ? 0.92 : state === "focused" ? 0.98 : state === "hovered" ? 0.94 : isDimIdle ? 0.48 : 0.84;
    const mist =
      state === "blocked" ? "#ffb54710" : state === "focused" ? "#8ccaff0e" : state === "hovered" ? "#ffffff08" : null;
    // 底部階梯像素托架（━━┓┗━━）與無框 #Tab 配色
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
      // 拖曳重排：按下記住來源，移到哪張卡就把 over 指到哪裡，放開才決定是拖曳還是點擊。
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
        // from === null：這一下不是從卡片上按下的（例如折疊徽章自己吃掉了按下事件），不要誤聚焦。
        if (from !== null && to !== null && from !== to) this.moveCard(from, to, cx);
        else if (from !== null) run("agent.focus", { terminal: a.address });
        cx.notify();
      })
      // 右側 240x96 CLI 特色外框（外圈 → 裝飾 → 內艙，乾淨極夜底板，零網點雜訊與黑泥底影）。
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
            // 內艙：inset 依流派查表，確保立繪 112x90 槽位精準對齊。
            div()
              .absolute()
              .inset(look.cabinInset)
              .rounded(0)
              .bg(skin.plate)
              .overflow_hidden()
              // 立繪微背襯光（Model 體系）
              .when(artBacking, (el) => el.child(modelBacking(family.primary, family.moon)))
              // 右貼半身立繪（圖檔頂部已留安全邊距，top(0) 完整保留胸口領結，非聚焦 IDLE 疊統一深冰夜壓暗幕）
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
              // 左向乾淨羽化過渡：銷點跟著立繪左緣，換寬度也不錯位
              .when(showArt && Boolean(art), (el) => el.child(fadeLayer(skin.plate, 90, fadeLeft)))
              // 狀態薄霧在羽化之上、文字之下
              .when(Boolean(mist), (el) => el.child(div().absolute().inset_0().bg(mist)))
              // 內艙細線與克制像素角飾
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
              // 側脊 / 品牌實條 / 4 角像素釘
              .when(Boolean(spine), (el) => el.child(spine))
              .when(Boolean(skin.leftBar), (el) =>
                el.child(div().absolute().left(0).top(0).bottom(0).w(4).bg(skin.leftBar[si])),
              )
              .when(Boolean(skin.nails), (el) => el.children(cornerPixels(skin.outer[si], 3, 2)))
              // 主從分明內艙排版：主角模型橫幅（left 10, top 18, w 160）+ 副信息 Effort（left 10, top 44, h 14）。
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
              // CLI 內角小徽記：Claude ✻ / Qwen ✧ / Kimi ☾ / Gemini 雙星。
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
          // 四態底槽動效（貼齊外框底邊 y=106 內側 bottom(1)，精確銜接於 Space 挖槽右側 x=152..right-1）
          .when(a.status === "working" && trackFits, (el) => el.child(workingTrack(trackStart, trackW)))
          .when(a.status === "blocked" && trackFits, (el) => el.child(blockedSlash(trackStart)))
          .when(a.status === "done" && trackFits, (el) =>
            el.child(div().absolute().left(trackStart).right(1).bottom(1).h(2).bg("#7fd8a866")),
          )
          // 聚焦/Blocked 時點亮與底部階梯托架+挖槽一致的外輪廓框
          .when(Boolean(unifiedOutline), (el) =>
            el.child(div().absolute().inset_0().rounded(0).border(1).border_color(unifiedOutline)),
          ),
      )
      // 名片底邊齊平方形挖槽：嚴格底對齊 y = PLATE_BOTTOM，絕不下凸破框，底邊敞口遮平底線。
      .child(
        div()
          .absolute()
          .left(PLATE_X + NOTCH_LEFT_IN_PLATE)
          .top(PLATE_BOTTOM - NOTCH_H)
          .child(spaceNotch(a, this.places, spaceName, notchBorder, notchW)),
      )
      // 底部階梯像素托架（━━┓┗━━）：腳底托盤 (y=74, x=4..54) -> 右折下探 (x=52, y=74..107) -> 底邊直連 (y=105..107, x=52..65)。
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
      // 左列企鵝立繪（48x64 穩踩在 y=74 水平托盤線上）
      .child(
        div()
          .absolute()
          .left(4)
          .top(SPRITE_TOP)
          .w(SPRITE_W)
          .h(SPRITE_H)
          .child(portrait(a, this.assigned, t)),
      )
      // 托盤下方無框 # Tab 標籤（y=80..100，x=4..50 窩在階梯折線左側，與右側 Space 挖槽呼應）
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
      // 騎框徽章層（在外框之後，才不會被 overflow_hidden 裁掉）。
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
      // 拖曳插入線：往下拖畫在目標下緣，往上拖畫在目標上緣。
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

  // Party 標題列的快捷收縮扣：320 <-> 196 兩檔，直接切到「極簡銘牌態」。
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
    // 剛出現的 agent 先補讀一次快取，不用等下一次計時器。
    const fresh = base.filter((a) => !this.seen.has(a.address));
    if (fresh.some((a) => cachePath(HOME, a.address) !== null)) this.load(cx);
    if (fresh.some((a) => remoteCachePath(a.address) !== null)) this.loadRemote(cx);
    if (base.some((a) => !((this.cache[a.address] ?? this.remote[a.address])?.model) && (!(a.address in this.screenModels) || this.lastSeq[a.address] !== a.seq))) {
      this.loadScreenModels(cx, false);
    }

    const compactRail = this.blockW > 0 && this.blockW < NARROW_PX;
    // 巢狀關係只在 terminals() 的 parent 上。nested 涵蓋所有 live 子代理，不看收合狀態：
    // 折起一個父母時，子代理也不能彈出來變成另一張 top-level 卡片。
    const kids = this.childIndex(compactRail ? [] : terminals());
    const nested = new Set();
    for (const a of base) for (const s of this.subtree(kids, a.address)) nested.add(s.k.address);
    // 使用者拖出來的順序優先；沒記錄過的（新 agent）排在已知的後面。
    const list = this.applyOrder(base.filter((a) => a.pinned || !nested.has(a.address)));
    this.listed = new Map(base.map((a) => [a.address, a.status]));
    this.focusedAgent = base.find((a) => a.focused)?.address ?? null;
    // 折疊狀態只清掉真的消失的父母；窄側邊欄沒有折疊 UI，不要因此清光。
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
          // 量到的是縮放後像素：除以 zoom 才是 layout px（zoom 1.2 時 320 → 379）。
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
              // 拖到卡片外才放開：清掉殘留的拖曳狀態，卡片不會一直半透明。
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
