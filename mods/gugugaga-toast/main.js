// Immersive 2D pixel Traveler notification toast.
// Configured via root "toast": "gugugaga-toast" in layouts/gugugaga.json.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, appHome, closeOverlay, panes, props, readTextFile, run, spaces, theme } from "herdr";
import { resolveToastContext, withAlpha } from "./lib.js";

const JOBS_FILE = `${appHome()}/mods/gugugaga-agents/jobs.json`;
const MONO_FONT = "Cascadia Mono";
// 與 gugugaga-agents / gugugaga-tabs 同一套狀態扣皮膚。
const STATUS_SKIN = {
  working: { bg: "#0e2238fa", border: "#8ccaffdd", text: "#d8eeff" },
  blocked: { bg: "#241708f8", border: "#ffb547ee", text: "#ffd080" },
  done: { bg: "#0d1d18f5", border: "#7fd8a899", text: "#9ae6be" },
  idle: { bg: "#0d131cf0", border: "#5d687866", text: "#7c8a9e" },
};
const STATUS_LABELS = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };

function cornerStuds(color) {
  const studColor = withAlpha(color, "cc");
  return [
    div().absolute().left(1).top(3).size(2).bg(studColor),
    div().absolute().right(1).top(3).size(2).bg(studColor),
    div().absolute().left(1).bottom(1).size(2).bg(studColor),
    div().absolute().right(1).bottom(1).size(2).bg(studColor),
  ];
}

function toastAgentBadge(info, t) {
  const color = info.color ?? t.accent;
  return h_flex()
    .flex_none()
    .h(15)
    .px(4)
    .gap(3)
    .items_center()
    .rounded(0)
    .bg(withAlpha(t.canvas, "e0"))
    .border(1)
    .border_color(withAlpha(color, "88"))
    .child(info.tint ? svg(info.logo).size(11).flex_none().text_color(color) : image(info.logo).size(11).flex_none())
    .child(div().flex_none().font_family(MONO_FONT).font_semibold().text_size(9.5).text_color(color).child(info.short || info.text));
}

function toastStatusBadge(status, color, t) {
  const skin = STATUS_SKIN[status.key] ?? { bg: withAlpha(color, "1a"), border: withAlpha(color, "44"), text: color };
  const label = STATUS_LABELS[status.key] ?? String(status.label ?? "").toUpperCase();
  const mark =
    status.key === "working"
      ? div().w(9).flex().items_center().justify_center().text_size(9).text_color(color).frames(["▘", "▝", "▗", "▖"], 140)
      : status.key === "blocked"
        ? div().w(9).flex().items_center().justify_center().font_bold().text_size(9.5).text_color(color).frames(["!", " "], 450)
        : div().flex_none().text_size(9).text_color(color).child(status.mark);
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

export default class TravelerToast extends View {
  init(_props, cx) {
    this.jobs = {};
    this.hovered = false;
    this.copied = false;
    cx.spawn(async (cx) => {
      const text = await readTextFile(JOBS_FILE).catch(() => null);
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.jobs = parsed;
      } catch {}
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const ctx = resolveToastContext({
      props: p,
      spacesList: spaces(),
      agentsList: agents(),
      panesList: panes(),
      jobs: this.jobs,
    });
    const { parsed, status, sprite, portrait, appInfo, spaceLabel, tabText } = ctx;
    const accentColor =
      status.key === "info"
        ? t.accent
        : t[status.key] ?? t.dim;
    const titleText = parsed.loginMachine ? `${parsed.loginMachine} needs a login: run` : p.title ?? "";

    const avatar = div()
      .size(40)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(0)
      .bg(withAlpha(t.canvas, "eb"))
      .border(1)
      .border_color(withAlpha(accentColor, "99"))
      .when(Boolean(portrait), (el) => el.child(image(portrait).size(36).flex_none()))
      .when(!portrait && Boolean(parsed.loginMachine), (el) => el.child(image("mods/gugugaga-spaces/art/device-remote.svg").size(20).flex_none()))
      .when(!portrait && !parsed.loginMachine && Boolean(sprite), (el) => el.child(image(sprite).w(27).h(36).flex_none()))
      .when(!sprite && !portrait && !parsed.loginMachine && Boolean(p.icon), (el) => el.child(image(p.icon).size(22).flex_none()))
      .when(!sprite && !portrait && !parsed.loginMachine && !p.icon && Boolean(appInfo), (el) =>
        el.child(appInfo.tint ? svg(appInfo.logo).size(20).text_color(appInfo.color ?? t.foreground) : image(appInfo.logo).size(20).flex_none()),
      )
      .when(!sprite && !portrait && !parsed.loginMachine && !p.icon && !appInfo, (el) =>
        el.child(div().font_bold().text_size(14).text_color(accentColor).child(status.mark)),
      );

    return div()
      .id("toast")
      .size_full()
      .p(2)
      .rounded(0)
      .bg(this.hovered ? t.raised : t.popover)
      .cursor_pointer()
      .on_hover((on, cx) => {
        this.hovered = on;
        cx.notify();
      })
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(
        div()
          .relative()
          .size_full()
          .rounded(0)
          .border(1)
          .border_color(withAlpha(accentColor, this.hovered ? "cc" : "88"))
          .child(div().absolute().left(0).right(0).top(0).h(2).bg(accentColor))
          .children(cornerStuds(accentColor))
          .child(
            h_flex()
              .size_full()
              .px(8)
              .py(5)
              .gap(9)
              .items_center()
              .child(avatar)
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .gap(4)
                  .justify_center()
                  .overflow_hidden()
                  .child(
                    h_flex()
                      .w_full()
                      .min_w(0)
                      .h(16)
                      .gap(5)
                      .items_center()
                      .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12.5).text_color(t.foreground).child(titleText))
                      .child(toastStatusBadge(status, accentColor, t))
                      .child(
                        div()
                          .id("toast-dismiss")
                          .size(15)
                          .flex_none()
                          .flex()
                          .items_center()
                          .justify_center()
                          .text_size(12)
                          .text_color(t.dim)
                          .hover((s) => s.text_color(t.foreground))
                          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                          .on_click((_e, cx) => {
                            cx.stop_propagation();
                            closeOverlay(p.overlay);
                          })
                          .child("×"),
                      ),
                  )
                  .when(Boolean(parsed.loginMachine), (el) =>
                    el.child(
                      h_flex()
                        .w_full()
                        .min_w(0)
                        .gap(6)
                        .items_center()
                        .child(div().flex_1().min_w(0).truncate().tooltip(parsed.command).text_size(11).text_color(t.muted).child(parsed.command))
                        .child(
                          div()
                            .id("toast-login-copy")
                            .flex_none()
                            .px(6)
                            .py(2)
                            .bg(t.raised)
                            .border(1)
                            .border_color(t.border)
                            .text_size(10.5)
                            .text_color(t.foreground)
                            .cursor_pointer()
                            .hover((s) => s.bg(t.hover))
                            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                            .on_click((_e, cx) => {
                              cx.stop_propagation();
                              cx.write_to_clipboard(parsed.command);
                              this.copied = true;
                              cx.notify();
                            })
                            .child(this.copied ? "Copied" : "Copy"),
                        ),
                    ),
                  )
                  .when(!parsed.loginMachine && (Boolean(spaceLabel) || Boolean(p.body) || Boolean(appInfo)), (el) =>
                    el.child(
                      h_flex()
                        .w_full()
                        .min_w(0)
                        .h(16)
                        .gap(5)
                        .items_center()
                        .when(Boolean(appInfo), (row) => row.child(toastAgentBadge(appInfo, t)))
                        .when(Boolean(spaceLabel), (row) =>
                          row.child(
                            h_flex()
                              .flex_1()
                              .min_w(0)
                              .h(15)
                              .px(5)
                              .gap(4)
                              .items_center()
                              .bg(withAlpha(t.canvas, "a8"))
                              .border(1)
                              .border_color(withAlpha(t.border, "55"))
                              .child(div().flex_none().text_size(9).text_color(t.accent).child("▸"))
                              .child(div().min_w(0).truncate().text_size(10).font_medium().text_color(t.foreground).child(spaceLabel))
                              .when(Boolean(tabText), (pill) =>
                                pill
                                  .child(div().flex_none().text_size(9.5).text_color(t.dim).child("·"))
                                  .child(div().flex_none().text_size(10).text_color(t.muted).child(tabText)),
                              ),
                          ),
                        )
                        .when(!spaceLabel && Boolean(p.body), (row) =>
                          row.child(
                            h_flex()
                              .flex_1()
                              .min_w(0)
                              .gap(4)
                              .items_center()
                              .child(div().flex_none().text_size(9).text_color(accentColor).child("▸"))
                              .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.muted).child(p.body ?? "")),
                          ),
                        ),
                    ),
                  ),
              ),
          ),
      );
  }
}
