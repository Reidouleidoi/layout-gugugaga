// 分屏终端顶栏的纯数据层：不碰 herdr / gpui-kit，可被 node 直接加载测试。
// CLI 品牌色表与 gugugaga-agents/lib.js 的 resolveAppInfo 同一套（mod 之间不跨目录 import，
// 所以这里保留一份精简副本），只用来决定顶栏顶条与徽标框的颜色。

const APPS = new Map([
  ["antigravity", { text: "Antigravity", short: "AGY", logo: "mods/gugugaga-agents/art/logo-antigravity.svg", color: "#38bdf8" }],
  ["pi", { text: "Pi", short: "pi", logo: "mods/gugugaga-agents/art/logo-pi.svg", color: "#00d4ff" }],
  ["claude-code", { text: "Claude", short: "Claude", logo: "mods/gugugaga-agents/art/logo-claude.svg", color: "#d97757" }],
  ["claude", { text: "Claude", short: "Claude", logo: "mods/gugugaga-agents/art/logo-claude.svg", color: "#d97757" }],
  ["codex", { text: "Codex", short: "Codex", logo: "mods/gugugaga-agents/art/logo-codex.svg", color: "#e5e7eb" }],
  ["opencode", { text: "OpenCode", short: "OpenCode", logo: "mods/gugugaga-agents/art/logo-opencode.svg", color: "#fab283" }],
  ["gemini", { text: "Gemini", short: "Gemini", logo: "mods/gugugaga-agents/art/logo-gemini.svg", color: "#7aa8ff" }],
  ["gemini-cli", { text: "Gemini", short: "Gemini", logo: "mods/gugugaga-agents/art/logo-gemini.svg", color: "#7aa8ff" }],
  ["hermes", { text: "Hermes", short: "Hermes", logo: "mods/gugugaga-agents/art/logo-hermes.svg", color: "#eab354" }],
  ["qwen", { text: "Qwen", short: "Qwen", logo: "mods/gugugaga-agents/art/logo-qwen.svg", color: "#7aa2ff" }],
  ["qwen-code", { text: "Qwen", short: "Qwen", logo: "mods/gugugaga-agents/art/logo-qwen.svg", color: "#7aa2ff" }],
  ["kimi", { text: "Kimi", short: "Kimi", logo: "mods/gugugaga-agents/art/logo-kimi.svg", color: "#e2e8f0" }],
  ["kimi-code", { text: "Kimi", short: "Kimi", logo: "mods/gugugaga-agents/art/logo-kimi.svg", color: "#e2e8f0" }],
]);

const clean = (v, max) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;

function fromKey(key) {
  if (typeof key !== "string") return null;
  const found = APPS.get(key.trim().toLowerCase());
  return found ? { ...found, key: key.trim().toLowerCase() } : null;
}

// p: PaneInfo（herdr 的 panes() 一条）。认得的 CLI 才有 color / logo；
// 其余（cmd / powershell / 一般程序）回 { color: null }，由 main.js 决定回落。
export function resolvePaneApp(p) {
  const byApp = fromKey(p?.app);
  if (byApp) return byApp;
  const byProgram = fromKey(p?.program?.key);
  if (byProgram) return byProgram;
  const name = clean(p?.program?.name, 24);
  if (name) {
    const lower = name.toLowerCase();
    for (const [k, v] of APPS) if (lower === k || lower.includes(k)) return { ...v, key: k };
  }
  return { key: null, text: name || clean(p?.app, 24) || "shell", short: name || "shell", logo: null, color: null };
}

// 路径末级目录名：Windows 与 POSIX 反斜线都吃，根目录留 drive/"/"。
export function lastSegment(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "";
  const trimmed = cwd.replace(/[\\/]+$/, "");
  if (!trimmed) return cwd.slice(0, 1);
  const parts = trimmed.split(/[\\/]/);
  const last = parts[parts.length - 1] || trimmed;
  return last;
}

// 终端地址在顶栏要短：机器名保留，其余原样（t125 / vps/t3）。
export function shortAddress(terminal) {
  if (typeof terminal !== "string") return "";
  return terminal.trim().slice(0, 24);
}
