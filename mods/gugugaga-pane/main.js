// Gugugaga Pane Header：28px 像素功能台顶栏。
// 取代原生 pane 标头，保留原生全部交互：点击聚焦、分割（右/下）、缩放、关闭，
// 以及 app 由 p.movable 提供的拖拽重排（握把只是视觉，不拦截事件）。
// Props: { pane, terminal }。数据源 herdr 的 panes()。

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, props, run, theme, settings, layout } from "herdr";
import { lastSegment, resolvePaneApp, shortAddress } from "./lib.js";

const MONO = "Cascadia Mono";
// 与 gugugaga-agents / -tabs / -toast 同一套状态扣皮肤。
const STATUS_SKIN = {
  working: { bg: "#0e2238fa", border: "#8ccaffdd", text: "#d8eeff" },
  blocked: { bg: "#241708f8", border: "#ffb547ee", text: "#ffd080" },
  done: { bg: "#0d1d18f5", border: "#7fd8a899", text: "#9ae6be" },
  idle: { bg: "#0d131cf0", border: "#5d687866", text: "#7c8a9e" },
};
const STATUS_LABEL = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };
const withAlpha = (c, a) => (typeof c === "string" && c.startsWith("#") ? `${c.slice(0, 7)}${a}` : c);

// 标头在顶还是底（原生行为：底部标头改用上边线），只有第一棵可见分页框有话语权。
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter((child) => !child.hidden);
    children = [visible.find((child) => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

export default class GugugagaPane extends View {
  init() {
    this.hovered = false;
    this.paneW = 0; // on_size_change 量到的是缩放后像素，除以 zoom 才是 layout px
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // 16x16 像素徽标槽：#07090d 实底 + 1px CLI 色细框 + 11x11 像素 Logo。
  badge(p, info, cliColor, t) {
    const logo = info.color
      ? info.logo
      : p.program?.icon ?? "mods/gugugaga-chrome/terminal.svg";
    const tint = info.color ? Boolean(info.tint) : p.program?.icon ? Boolean(p.program.tint) : true;
    return div()
      .size(16)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(0)
      .bg("#07090d")
      .border(1)
      .border_color(info.color ? withAlpha(cliColor, "88") : t.border)
      .child(
        tint
          ? svg(logo).size(11).flex_none().text_color(info.color ? cliColor : p.focused ? t.muted : t.dim)
          : image(logo).size(11).flex_none(),
      );
  }

  // 拖拽握把：2x3 个 2x2 像素点（不用字体字符，任何机器都不会变 tofu）。
  grip() {
    const color = this.hovered ? "#5c6676" : "#2b3444";
    const col = () => v_flex().flex_none().gap(2).children([0, 1, 2].map(() => div().size(2).bg(color)));
    return div().flex_none().flex().gap(2).items_center().child(col()).child(col());
  }

  // 状态扣：Mono 全大写；窄分屏时退成纯符号扣。
  statusBadge(status, iconOnly) {
    const skin = STATUS_SKIN[status] ?? STATUS_SKIN.idle;
    const mark =
      status === "working"
        ? div().w(8).flex().items_center().justify_center().text_size(8.5).text_color(skin.text).frames(["▘", "▝", "▗", "▖"], 140)
        : status === "blocked"
          ? div().w(8).flex().items_center().justify_center().font_bold().text_size(9).text_color(skin.text).frames(["!", " "], 450)
          : div().flex_none().text_size(8.5).text_color(skin.text).child(status === "done" ? "✓" : "▪");
    return h_flex()
      .flex_none()
      .h(17)
      .px(iconOnly ? 3 : 5)
      .gap(3)
      .items_center()
      .rounded(0)
      .bg(skin.bg)
      .border(1)
      .border_color(skin.border)
      .child(mark)
      .when(!iconOnly, (el) =>
        el.child(
          div()
            .flex_none()
            .font_family(MONO)
            .font_semibold()
            .text_size(9)
            .text_color(skin.text)
            .child(STATUS_LABEL[status] ?? String(status).toUpperCase()),
        ),
      );
  }

  // 悬停操作钮：20x20 直角像素扣，hover 亮 accent 框；一律 stop_propagation 不抢聚焦。
  actionButton(t, id, icon, command, args) {
    return div()
      .id(id)
      .size(20)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(0)
      .bg("#07090d")
      .border(1)
      .border_color("#232a36")
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.border_color(t.accent).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane/${icon}.svg`).size(12));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();

    const pane = p.pane;
    const focused = p.focused;
    const info = resolvePaneApp(p);
    const cliColor = info.color ?? t.accent;
    const blocked = p.status === "blocked";
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const paneW = this.paneW;
    const iconOnly = paneW > 0 && paneW < 280;

    const name = info.color ? info.short || info.text : p.program?.name || p.title || "shell";
    const dir = lastSegment(p.cwd);
    const showBranch = Boolean(p.branch) && (paneW === 0 || paneW >= 360);

    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .relative()
      .px(8)
      .gap(6)
      .items_center()
      .bg(focused ? "#121824" : "#0b0e14")
      .when(bottom, (el) => el.border_t(1))
      .when(!bottom, (el) => el.border_b(1))
      .border_color(focused ? "#2b374a" : "#1c222d")
      .on_size_change((size, cx) => {
        const z = settings()?.zoom;
        const zoom = typeof z === "number" && z > 0 ? z : 1;
        const next = size.width / zoom;
        if (!this.paneW || Math.abs(this.paneW - next) > 1.5) {
          this.paneW = next;
          cx.notify();
        }
      })
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane }))
      // 顶部 2px 语意识别条：blocked 呼吸琥珀优先，其次聚焦时的 CLI 品牌色。
      .when(focused || blocked, (el) =>
        el.child(
          div()
            .absolute()
            .left(0)
            .right(0)
            .when(bottom, (bar) => bar.bottom(0))
            .when(!bottom, (bar) => bar.top(0))
            .h(2)
            .bg(blocked ? t.blocked : cliColor)
            .when(blocked, (bar) => bar.loop("opacity", { from: 0.35, to: 1.0, period: 1100, easing: "ease-in-out" })),
        ),
      )
      // 聚焦时左右上角各一颗 2x2 像素角钉（CLI 色）。
      .when(focused, (el) =>
        el
          .child(div().absolute().left(0).top(2).size(2).bg(withAlpha(cliColor, "cc")))
          .child(div().absolute().right(0).top(2).size(2).bg(withAlpha(cliColor, "cc"))),
      )
      .child(this.badge(p, info, cliColor, t))
      .child(
        div()
          .flex_none()
          .truncate()
          .font_family(MONO)
          .font_bold()
          .text_size(10.5)
          .text_color(focused ? "#e6ebf2" : t.muted)
          .child(name),
      )
      // 终端地址微标签：t125 / vps/t3。
      .when(Boolean(p.terminal), (el) =>
        el.child(
          h_flex()
            .flex_none()
            .h(15)
            .px(4)
            .items_center()
            .justify_center()
            .rounded(0)
            .bg("#07090d")
            .border(1)
            .border_color("#232a36")
            .font_family(MONO)
            .text_size(9)
            .text_color(focused ? "#94a0b2" : "#6b7a8f")
            .child(shortAddress(p.terminal)),
        ),
      )
      // 末级目录 + 分支：极窄分屏只留目录名，分支让位。
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .font_family(MONO)
          .text_size(9.5)
          .text_color(t.dim)
          .when(Boolean(p.cwd), (el) => el.tooltip(String(p.cwd)))
          .child(dir ? (showBranch ? `${dir} · ${p.branch}` : dir) : ""),
      )
      .when(p.movable, (el) => el.child(this.grip()))
      // 回底扣：离底部还有历史时出现。
      .when(Boolean(p.scroll?.from_bottom > 0), (el) =>
        el.child(
          div()
            .id(`ph-b-${pane}`)
            .flex_none()
            .px(4)
            .h(15)
            .flex()
            .items_center()
            .justify_center()
            .rounded(0)
            .bg("#07090d")
            .border(1)
            .border_color(withAlpha(t.accent, "55"))
            .font_family(MONO)
            .text_size(9)
            .text_color(t.accent)
            .cursor_pointer()
            .hover((s) => s.border_color(t.accent))
            .tooltip("Scroll to bottom")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              run("terminal.scroll", { to: "bottom", terminal: p.terminal });
            })
            .child(p.scroll.from_bottom > 999 ? "↓999+" : `↓${p.scroll.from_bottom}`),
        ),
      )
      .when(Boolean(p.status), (el) => el.child(this.statusBadge(p.status, iconOnly)))
      .when(p.zoomed, (el) =>
        el.child(
          div()
            .flex_none()
            .px(4)
            .h(15)
            .flex()
            .items_center()
            .justify_center()
            .rounded(0)
            .bg(withAlpha(t.accent, "1c"))
            .border(1)
            .border_color(withAlpha(t.accent, "77"))
            .font_family(MONO)
            .font_bold()
            .text_size(9)
            .text_color(t.accent)
            .child("Z"),
        ),
      )
      .when(this.hovered, (el) =>
        el
          .child(this.actionButton(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
          .child(this.actionButton(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
          .child(this.actionButton(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
          .child(this.actionButton(t, `ph-x-${pane}`, "close", "pane.close", { pane })),
      );
  }
}
