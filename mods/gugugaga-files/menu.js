// The right-click popup. Opened by files.js / changes.js with
// props { role: "menu", panel, panelId, path, dir, overlay }.
// ↑/↓ move, Enter runs, Esc closes.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay, props, setShared, theme } from "herdr";
import { ACTIONS, RUN_KEY } from "./actions.js";

const MONO = "Cascadia Mono";

export default class Menu {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // A popup's async work dies with it, so this menu runs nothing: it leaves the
  // choice in shared state, where the panel (which stays alive) picks it up.
  choose(i) {
    const p = props(), action = ACTIONS[i]?.id;
    if (!p || !action) return;
    setShared(RUN_KEY, {
      panel: p.panel,
      panelId: p.panelId,
      path: p.path,
      dir: Boolean(p.dir),
      action,
      at: Date.now(),
    });
    closeOverlay(p.overlay);
  }

  render(cx) {
    const t = theme(), p = props();
    const name = String(p?.path ?? "").split(/[\\/]/).pop() || p?.path || "";
    return v_flex()
      .id("files-and-changes-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .border(1)
      .border_color(t.border)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % ACTIONS.length;
        else if (e.key === "up") this.at = (this.at + ACTIONS.length - 1) % ACTIONS.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .child(div().h(26).px(8).pt(4).font_family(MONO).text_size(10).text_color(t.dim).truncate().child(name))
      .children(ACTIONS.map((action, i) =>
        h_flex()
          .id(`files-and-changes-action-${action.id}`)
          .relative()
          .h(31)
          .px(8)
          .gap(9)
          .rounded(0)
          .items_center()
          .cursor_pointer()
          .text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .when(i === this.at, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(i))
          .child(div().flex_1().truncate().child(action.label(Boolean(p?.dir))))));
  }
}
