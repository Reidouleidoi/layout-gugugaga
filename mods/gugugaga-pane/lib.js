// 分屏終端頂欄的純資料層：不碰 herdr / gpui-kit，可被 node 直接載入測試。
// CLI 品牌色表與 gugugaga-agents/lib.js 的 resolveAppInfo 同一套（mod 之間不跨目錄 import，
// 所以這裡保留一份精簡拷貝），只用來決定頂欄頂條與徽標框的顏色。

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

// p: PaneInfo（herdr 的 panes() 一條）。認得的 CLI 才有 color / logo；
// 其餘（cmd / powershell / 一般程式）回 { color: null }，由 main.js 決定回落。
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

// 路徑末級目錄名：Windows 與 POSIX 反斜線都吃，根目錄留 drive/"/"。
export function lastSegment(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "";
  const trimmed = cwd.replace(/[\\/]+$/, "");
  if (!trimmed) return cwd.slice(0, 1);
  const parts = trimmed.split(/[\\/]/);
  const last = parts[parts.length - 1] || trimmed;
  return last;
}

// 終端地址在頂欄要短：機器名保留，其餘原樣（t125 / vps/t3）。
export function shortAddress(terminal) {
  if (typeof terminal !== "string") return "";
  return terminal.trim().slice(0, 24);
}
