// Shared plumbing for the right-click menu: the two commands it runs, the
// path fix-ups, and the hand-off that lets a short-lived popup ask the
// long-lived panel to run one.
//
// The panels are cloned from Herdr's own `files` and `changes` mods (see
// README.md); this file and the menu are the addon.
import { exec, notify, openOverlay, setShared, shared, window } from "herdr";

export const MOD = "gugugaga-files";
export const RUN_KEY = `${MOD}/run`;

const isWindows = () => window()?.platform === "windows";
const isMac = () => window()?.platform === "macos";

// PowerShell one-liner with the path handed in as a quoted argument, so spaces,
// `&`, parentheses and Unicode names survive. `body` sees it as $p.
const ps = (body, path) => ["powershell", "-NoProfile", "-NonInteractive", "-Command",
  `& { param($p) ${body} } '${String(path).replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`];

// The panels build paths with "/" (rows use them as keys) and Windows tools
// expect "\": `explorer /select,"D:\x/y"` otherwise opens the wrong folder.
export function nativePath(path) {
  return isWindows() ? String(path).replaceAll("/", "\\") : String(path);
}

export const ACTIONS = [
  { id: "open", label: (dir) => (dir ? "Open folder" : "Open with default app") },
  {
    id: "reveal",
    label: () => (isMac() ? "Reveal in Finder" : isWindows() ? "Reveal in File Explorer" : "Open containing folder"),
  },
];

export function actionLabel(action, dir) {
  return ACTIONS.find((a) => a.id === action)?.label(dir) ?? action;
}

// [program, ...args], run on this machine without a shell.
export function argvFor(action, path, dir) {
  const p = nativePath(path);
  if (isWindows()) {
    if (action === "open") {
      return ps("if (-not (Test-Path -LiteralPath $p)) { throw 'This item no longer exists' }; Invoke-Item -LiteralPath $p", p);
    }
    // A deleted file has nothing to select: show its folder instead.
    return ps(
      "if (Test-Path -LiteralPath $p) { Start-Process explorer -ArgumentList ('/select,\"' + $p + '\"') } else { $parent = Split-Path -Parent $p; if (-not (Test-Path -LiteralPath $parent)) { throw 'This item no longer exists' }; Start-Process explorer -ArgumentList ('\"' + $parent + '\"') }",
      p,
    );
  }
  if (isMac()) {
    if (action === "open") return ["open", p];
    return ["sh", "-c", 'if [ -e "$1" ]; then open -R "$1"; else d=$(dirname "$1"); [ -d "$d" ] && open "$d"; fi', "reveal", p];
  }
  if (action === "open") return ["xdg-open", p];
  return ["sh", "-c", 'd=$(dirname "$1"); [ -d "$d" ] && xdg-open "$d"', "reveal", p];
}

// Runs one menu action from a live panel: a popup's async work dies with it.
export async function runAction(action, path, dir) {
  const argv = argvFor(action, path, dir);
  const r = await exec(argv[0], argv.slice(1)).catch((e) => ({ code: -1, stderr: String(e) }));
  if (r.code !== 0) {
    notify({ title: actionLabel(action, dir), body: (r.stderr || `Exited with ${r.code}`).trim(), level: "error" });
  }
}

// Popup height for the two rows: padding, the file name line, 31px rows.
export function menuHeight() {
  return 10 + 26 + ACTIONS.length * 31 + 4;
}

// `panelId` tells two copies of this mod (files and changes, or two layouts)
// apart, so only the copy whose menu opened runs the choice.
export function openMenu({ panel, panelId, path, dir }) {
  openOverlay({
    mod: MOD,
    kind: "popup",
    width: 250,
    height: menuHeight(),
    frame: "none",
    props: { role: "menu", panel, panelId, path, dir },
  });
}

// Called from a panel timer: one request per menu choice, and only ours.
export function takeRun(panelId, lastAt) {
  const req = shared(RUN_KEY);
  if (!req || req.panelId !== panelId || req.at === lastAt) return null;
  setShared(RUN_KEY, null);
  return req;
}
