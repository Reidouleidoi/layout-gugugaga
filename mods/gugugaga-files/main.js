// Files & Changes Addon: Herdr's right-hand files and changes panels, with
// soft-wrapped documents and a right-click menu (open with the default app,
// reveal in the file manager). One mod, three roles:
//   panel: "files"    the Files panel (files.js)
//   panel: "changes"  the Changes panel (changes.js)
//   role: "menu"      the right-click popup (menu.js), opened by either panel
// The layout picks a panel with props; see README.md.

import { View } from "gpui-kit";
import { props } from "herdr";
import Files from "./files.js";
import Changes from "./changes.js";
import Menu from "./menu.js";

export default class FilesAndChanges extends View {
  init(p, cx) {
    const given = props() ?? {};
    this.part = given.role === "menu" ? new Menu() : given.panel === "changes" ? new Changes() : new Files();
    this.part.init(p, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
