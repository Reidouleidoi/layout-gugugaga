// 收件箱：列出 appHome()/data/inbox/files 的文件，点一下用系统默认 App 打开。
// 右键：复制到桌面（不覆盖）、丢到垃圾桶（可救回）；此外不写档、不连网，
// 文件名一律当文本显示，exec 一律用参数数组。
// macOS 走原版 BSD 指令；Windows 走 PowerShell（路径在 lib.js 依 platform 决定）。
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, home, theme, watchFolder, window } from "herdr";
import {
  copyCommand, desktopCandidates, formatSize, isRegularFile, listCommand,
  mkdirCommand, openCommand, parseListing, statCommand, thumbSource, trashCommand,
} from "./lib.js";

const INBOX_DIR = appHome() + "/data/inbox/files";
const DESKTOP_DIR = home() + "/Desktop";
const MONO_FONT = "Cascadia Mono";
// 类型扣：短大写标签 + 2px 左侧类型色条。
const BADGE = { image: "IMG", video: "VID", pdf: "PDF", text: "MD" };
const BADGE_COLOR = { image: "#38bdf8", video: "#a78bfa", pdf: "#ffb547", text: "#6ee7b7" };

function clockText(seconds) {
  const d = new Date(seconds * 1000);
  const two = (n) => `0${n}`.slice(-2);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export default class Inbox extends View {
  init(_props, cx) {
    this.items = [];
    this.error = null;
    this.loading = true;
    this.notice = null;
    this.noticeOk = false;
    this.menuPath = null;
    this.platform = window()?.platform ?? null;
    this.desktop = DESKTOP_DIR;
    cx.spawn(async (cx) => {
      // Windows 的桌面可能在 OneDrive 底下，问系统要真正的那一个。
      if (this.platform === "windows") {
        const asked = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('Desktop')"]).catch(() => null);
        const found = asked && asked.code === 0 ? asked.stdout.trim() : "";
        if (found) this.desktop = found;
      }
      const made = mkdirCommand(INBOX_DIR, this.platform);
      const ok = await exec(made.cmd, made.args).catch(() => null);
      if (!ok || ok.code !== 0) {
        this.loading = false;
        this.error = `Cannot create the inbox folder: ${INBOX_DIR}`;
        cx.notify();
        return;
      }
      await this.load(cx);
      for (;;) {
        try {
          await watchFolder(INBOX_DIR);
        } catch {
          this.error = "Cannot watch the inbox folder";
          cx.notify();
          return;
        }
        await this.load(cx);
      }
    });
  }

  async load(cx) {
    const listed = listCommand(INBOX_DIR, this.platform);
    const result = await exec(listed.cmd, listed.args).catch(() => null);
    if (!result || result.code !== 0) {
      this.items = [];
      this.error = `Cannot read the inbox: ${INBOX_DIR}`;
    } else {
      this.items = parseListing(result.stdout, INBOX_DIR, this.platform);
      this.error = null;
    }
    this.loading = false;
    cx.notify();
  }

  // 动手前一律复查：还是收件箱里的一般文件（不是符号链接）。
  async stillRegular(item) {
    const stat = statCommand(item.path, this.platform);
    const checked = await exec(stat.cmd, stat.args).catch(() => null);
    return Boolean(checked && checked.code === 0 && isRegularFile(checked.stdout));
  }

  say(cx, text, ok = false) {
    this.notice = text;
    this.noticeOk = ok;
    cx.notify();
  }

  // 点一列：先确认还是收件箱里的一般文件，再交给 open。
  launch(item, cx) {
    this.menuPath = null;
    cx.spawn(async (cx) => {
      const command = (await this.stillRegular(item)) ? openCommand(item.path, INBOX_DIR, this.platform) : null;
      if (!command) return this.say(cx, `Cannot open: ${item.name}`);
      const opened = await exec(command.cmd, command.args).catch(() => null);
      if (opened && opened.code === 0) {
        this.notice = null;
        cx.notify();
      } else {
        this.say(cx, `Cannot open: ${item.name}`);
      }
    });
  }

  // 复制到桌面：原名先试，撞名就换「 2」「 3」…，cp -n 保证不盖掉桌面上的文件。
  copyToDesktop(item, cx) {
    this.menuPath = null;
    cx.spawn(async (cx) => {
      if (!(await this.stillRegular(item))) return this.say(cx, `Cannot copy: ${item.name}`);
      for (const name of desktopCandidates(item.name)) {
        const command = copyCommand(item.path, INBOX_DIR, this.desktop, name, this.platform);
        if (!command) break;
        const copied = await exec(command.cmd, command.args).catch(() => null);
        if (copied && copied.code === 0) return this.say(cx, `Copied to the Desktop: ${name}`, true);
        if (!copied) break;
      }
      this.say(cx, `Cannot copy to the Desktop: ${item.name}`);
    });
  }

  // 丢到垃圾桶：macOS 用内置 trash，Windows 用资源回收筒，误删都可以救回。
  moveToTrash(item, cx) {
    this.menuPath = null;
    cx.spawn(async (cx) => {
      const command = (await this.stillRegular(item)) ? trashCommand(item.path, INBOX_DIR, this.platform) : null;
      if (!command) return this.say(cx, `Cannot move to the Trash: ${item.name}`);
      const trashed = await exec(command.cmd, command.args).catch(() => null);
      if (trashed && trashed.code === 0) this.say(cx, `Moved to the Trash: ${item.name}`, true);
      else this.say(cx, `Cannot move to the Trash: ${item.name}`);
    });
  }

  menuItem(id, label, t, action) {
    return div()
      .id(id)
      .px(10)
      .py(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_event, cx) => action(cx))
      .child(label);
  }

  menu(item, index, t) {
    return v_flex()
      .id(`inbox-menu-${index}`)
      .flex_none()
      .mx(10)
      .mb(4)
      .py(4)
      .rounded(0)
      .bg("#0d1118")
      .border_1()
      .border_color("#1e2430")
      .text_size(12)
      .on_mouse_down_out((_event, cx) => {
        this.menuPath = null;
        cx.notify();
      })
      .child(this.menuItem(`inbox-copy-${index}`, "Copy to Desktop", t, (cx) => this.copyToDesktop(item, cx)))
      .child(this.menuItem(`inbox-trash-${index}`, "Move to Trash", t, (cx) => this.moveToTrash(item, cx)));
  }

  // 缩略图 / 类型扣共用的 40x40 像素槽：直角、#07090d 实底、1px 边框。
  slot(t, child) {
    return div()
      .size(40)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(0)
      .bg(t.canvas)
      .border(1)
      .border_color(t.border)
      .child(child);
  }

  badge(item, t) {
    return div()
      .relative()
      .size_full()
      .flex()
      .items_center()
      .justify_center()
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(BADGE_COLOR[item.kind] ?? t.dim))
      .child(div().font_family(MONO_FONT).font_semibold().text_size(9).text_color(t.muted).child(BADGE[item.kind] ?? "FILE"));
  }

  row(item, index, t) {
    const thumb = thumbSource(item);
    return h_flex()
      .id(`inbox-row-${index}`)
      .h(52)
      .flex_none()
      .px(10)
      .gap(10)
      .items_center()
      .rounded(0)
      .bg("#0d1118")
      .border(1)
      .border_color("#1e2430")
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).border_color("#232a36"))
      .on_click((_event, cx) => this.launch(item, cx))
      .on_mouse_down("right", (_event, cx) => {
        this.menuPath = this.menuPath === item.path ? null : item.path;
        cx.notify();
      })
      .child(this.slot(t, thumb ? image(thumb).size(38).flex_none() : this.badge(item, t)))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(div().truncate().child(item.name))
          .child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child(`${formatSize(item.size)} · ${clockText(item.mtime)}`),
          ),
      );
  }

  render(cx) {
    const t = theme();
    const rows = this.items.flatMap((item, index) =>
      item.path === this.menuPath ? [this.row(item, index, t), this.menu(item, index, t)] : [this.row(item, index, t)]);
    return v_flex()
      .id("inbox")
      .size_full()
      .min_h(0)
      // 与 FILES / CHANGES 面板同一条 1px 外框，切换 stall 时没有跳变。
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(14)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().flex_none().font_family(MONO_FONT).font_bold().text_size(11).text_color(t.muted).child("INBOX"))
          .child(
            h_flex()
              .flex_none()
              .px(4)
              .h(15)
              .items_center()
              .justify_center()
              .rounded(0)
              .border(1)
              .border_color(t.border)
              .bg(t.canvas)
              .font_family(MONO_FONT)
              .text_size(10)
              .text_color(t.accent)
              .child(`[${this.items.length}]`),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(6)
          .gap(3)
          .children(rows)
          .when(Boolean(this.notice), (el) => el.child(div().p(8).text_size(12).text_color(this.noticeOk ? t.dim : t.blocked).child(this.notice)))
          .when(Boolean(this.error), (el) => el.child(div().p(8).text_size(12).text_color(t.blocked).child(this.error)))
          .when(!this.error && this.items.length === 0, (el) =>
            el
              .child(div().p(8).text_size(12).text_color(t.dim).child(this.loading ? "Loading…" : "The inbox is empty"))
              .child(div().px(8).text_size(11).text_color(t.muted).child(INBOX_DIR)),
          ),
      );
  }
}
