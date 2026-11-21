// 收件箱的纯函数：不碰 herdr / gpui-kit，可以被 node 直接加载测试。
// 这里只做字符串与数据的处理；跑指令、画画面都在 main.js。
//
// 平台：macOS 走 BSD 指令（find / stat -f / open / cp -n / trash），
// Windows 走 PowerShell（本机改写，2026-08 加在 Herdr 0.1.12 上）。
// 每个指令构造函数都收 platform，main.js 从 window().platform 传进来。

export const MAX_ITEMS = 200;
export const MAX_THUMB_BYTES = 20 * 1024 * 1024;

const THUMB_PREFIX = "data/inbox/files/";
const WINDOWS = "windows";
const POWERSHELL = "powershell";

// 扩展名白名单：只有这几种可以列出来、可以 open。
const KINDS = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  mp4: "video",
  mov: "video",
  pdf: "pdf",
  md: "text",
};

export const MAX_DESKTOP_TRIES = 20;

function isWindows(platform) {
  return platform === WINDOWS;
}

// PowerShell 单引号字符串：只跳脱单引号，其余原样（不用双引号，免得 $ 被展开）。
function psQuote(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

function ps(script) {
  return { cmd: POWERSHELL, args: ["-NoProfile", "-NonInteractive", "-Command", script] };
}

// 文件名一律当成单一文件名看待：不能有路径、不能是隐藏档。
function isPlainName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !name.startsWith(".")
  );
}

// 文件夹结尾的斜线不影响比对，其他一律原样。
function prefixOf(dir) {
  const s = typeof dir === "string" ? dir : "";
  const trimmed = s.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed + "/";
}

export function kindOf(name) {
  if (!isPlainName(name)) return null;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  const kind = KINDS[ext];
  return typeof kind === "string" ? kind : null;
}

export function isAllowedName(name) {
  return kindOf(name) !== null;
}

// 只有收件箱第一层的白名单文件名才算数；回传文件名，不合格回 null。
function inboxName(path, dir) {
  const prefix = prefixOf(dir);
  if (typeof path !== "string" || !path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  if (name.includes("/") || name.includes("\\")) return null;
  return isAllowedName(name) ? name : null;
}

const byNewest = (a, b) =>
  b.mtime - a.mtime || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function finish(items) {
  items.sort(byNewest);
  return items.slice(0, MAX_ITEMS);
}

function lines(stdout) {
  return String(stdout ?? "").split("\n");
}

export function mkdirCommand(dir, platform) {
  if (isWindows(platform)) {
    // New-Item 没有 -LiteralPath，直接用 .NET，路径不会被通配符解读。
    return ps(`[void][System.IO.Directory]::CreateDirectory(${psQuote(dir)})`);
  }
  return { cmd: "/bin/mkdir", args: ["-p", dir] };
}

// macOS：find + stat 印「mtime size 完整路径」。
// Windows：Get-ChildItem 印「mtime size 文件名」，路径在 JS 这边接。
export function listCommand(dir, platform) {
  if (isWindows(platform)) {
    return ps(
      `Get-ChildItem -LiteralPath ${psQuote(dir)} -File -ErrorAction Stop | ForEach-Object { '{0} {1} {2}' -f [int]([datetimeoffset]$_.LastWriteTimeUtc).ToUnixTimeSeconds(), $_.Length, $_.Name }`,
    );
  }
  return {
    cmd: "/usr/bin/find",
    args: [
      dir, "-mindepth", "1", "-maxdepth", "1", "-type", "f",
      "-exec", "/usr/bin/stat", "-f", "%m %z %N", "{}", "+",
    ],
  };
}

// find + stat 的输出格式是每行「mtime size 路径」。
export function parseListing(stdout, dir, platform) {
  const items = [];
  if (isWindows(platform)) {
    for (const raw of lines(stdout)) {
      const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const m = /^(\d+) (\d+) (.+)$/.exec(text);
      if (!m) continue;
      const name = m[3];
      if (!isAllowedName(name)) continue;
      items.push({
        name,
        path: `${prefixOf(dir)}${name}`,
        mtime: Number(m[1]),
        size: Number(m[2]),
        kind: kindOf(name),
      });
    }
    return finish(items);
  }
  const prefix = prefixOf(dir);
  for (const raw of lines(stdout)) {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const m = /^(\d+) (\d+) (.+)$/.exec(text);
    if (!m) continue;
    const path = m[3];
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (!isAllowedName(name)) continue;
    items.push({
      name,
      path,
      mtime: Number(m[1]),
      size: Number(m[2]),
      kind: kindOf(name),
    });
  }
  return finish(items);
}

// macOS 的 %HT 只问类型，不跟随符号链接；Windows 用 ReparsePoint 判断，两边都印同一句话。
export function statCommand(path, platform) {
  if (isWindows(platform)) {
    return ps(
      `$f = Get-Item -LiteralPath ${psQuote(path)} -Force -ErrorAction Stop; if ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) { 'Link' } else { 'Regular File' }`,
    );
  }
  return { cmd: "/usr/bin/stat", args: ["-f", "%HT", path] };
}

export function isRegularFile(stdout) {
  return String(stdout ?? "").trim() === "Regular File";
}

// 只有收件箱第一层的白名单文件名可以 open。
export function openCommand(path, dir, platform) {
  if (inboxName(path, dir) === null) return null;
  if (isWindows(platform)) {
    return ps(`Invoke-Item -LiteralPath ${psQuote(path)} -ErrorAction Stop`);
  }
  return { cmd: "/usr/bin/open", args: [path] };
}

// 复制到桌面的目的文件名：原名先试，撞名照 Finder 的习惯加「 2」「 3」。
export function desktopCandidates(name) {
  if (!isAllowedName(name)) return [];
  const dot = name.lastIndexOf(".");
  const stem = name.slice(0, dot);
  const ext = name.slice(dot);
  const out = [name];
  for (let n = 2; n <= MAX_DESKTOP_TRIES; n += 1) out.push(`${stem} ${n}${ext}`);
  return out;
}

// cp -n 不覆盖既有文件（撞名时 exit 1，换下一个候选名）。
// Windows 的 Copy-Item 默认会覆盖，所以先 Test-Path，撞名一样 exit 1。
export function copyCommand(path, dir, destDir, name, platform) {
  if (inboxName(path, dir) === null) return null;
  if (!isAllowedName(name)) return null;
  if (isWindows(platform)) {
    if (typeof destDir !== "string" || !/^[A-Za-z]:[\\/]/.test(destDir)) return null;
    const dest = `${destDir.replace(/\\/g, "/").replace(/\/+$/, "")}/${name}`;
    return ps(
      `if (Test-Path -LiteralPath ${psQuote(dest)}) { exit 1 } else { Copy-Item -LiteralPath ${psQuote(path)} -Destination ${psQuote(dest)} -ErrorAction Stop }`,
    );
  }
  if (typeof destDir !== "string" || !destDir.startsWith("/")) return null;
  return { cmd: "/bin/cp", args: ["-n", "--", path, prefixOf(destDir) + name] };
}

// 丢到垃圾桶：macOS 用内置 trash（可救回），Windows 走资源回收筒（一样可救回）。
export function trashCommand(path, dir, platform) {
  if (inboxName(path, dir) === null) return null;
  if (isWindows(platform)) {
    return ps(
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${psQuote(path)},'OnlyErrorDialogs','SendToRecycleBin')`,
    );
  }
  return { cmd: "/usr/bin/trash", args: [path] };
}

// image() 只读 Herdr 家目录的相对路径，所以回传 data/inbox/files/<文件名>。
export function thumbSource(item) {
  if (!item || item.kind !== "image") return null;
  if (kindOf(item.name) !== "image") return null;
  const size = item.size;
  if (typeof size !== "number" || !Number.isFinite(size)) return null;
  if (size < 0 || size > MAX_THUMB_BYTES) return null;
  return THUMB_PREFIX + item.name;
}

export function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
