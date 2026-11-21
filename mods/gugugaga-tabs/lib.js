// 旅人分页列 MOD 的纯函数：不碰 herdr / gpui-kit，可以被 node 直接加载测试。
// 这里只做数据处理；读缓存、画画面都在 main.js。

export const JOBS = [
  // 本仓库只发 gugugaga 一套素材；原 8 职业、maomeme/maid 与 dora 的图已移到
  // ../archive-traveler-dora/ 备份，不再随仓库发布。
  "gugugaga",
];

// 缓存超过这么久就标「旧」：statusLine 每次回应都会重写，5 分钟没动就不算即时。
export const STALE_SECONDS = 300;

const JOB_SET = new Set(JOBS);
const SESSIONS_DIR = "data/traveler/sessions";

// 动态资源池：默认用已知清单兜底，启动与文件夹异动时由 main.js 通过 readdir 覆盖，
// 确保手动增删 art/gugugaga 或 sprites/gugugaga/{r,w,b} 文件时不会抽到已删除的图。
let GUGUGAGA_POOLS = {
  portrait: ["mods/gugugaga-agents/art/gugugaga/a1.png"],
  rest: ["mods/gugugaga-agents/sprites/gugugaga/r/gugu-rest.gif"],
  working: ["mods/gugugaga-agents/sprites/gugugaga/w/gugu-working.gif"],
  blocked: ["mods/gugugaga-agents/sprites/gugugaga/b/gugu-blocked.gif"],
};
export function setGugugagaPools(next) {
  if (!next || typeof next !== "object") return;
  for (const k of ["portrait", "rest", "working", "blocked"]) {
    if (Array.isArray(next[k])) GUGUGAGA_POOLS[k] = next[k];
  }
}

// 抽选缓存：`key|state -> 文件名`。每个 tab 与状态各自独立缓存，
// 互不影响；只有该文件被手动删除或模块重载时才会重新随机。
const PICKS = new Map();
export function resetPicks() { PICKS.clear(); }
function pick(key, state, pool) {
  if (!pool || pool.length === 0) return null;
  const k = `${key || "_"}|${state}`;
  const hit = PICKS.get(k);
  if (hit && pool.includes(hit)) return hit;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  PICKS.set(k, picked);
  return picked;
}


// 本机终端代号：跟 scripts/traveler-statusline.mjs 写文件名的规则一致，不收路径字符。
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const withAlpha = (c, a) => (typeof c === "string" && c.startsWith("#") ? `${c.slice(0, 7)}${a}` : c);

// 0–100 的有限数才算百分比，其余（含 null、字符串、超出范围）都当没有数据。
function pct(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : [...s].slice(0, max).join("");
}

// session 名称（Claude Code 的 /rename）：去掉控制字符与文本方向控制字符、收敛空白，最多 80 字；
// 跟 scripts/traveler-statusline.mjs 同一套规则，读的时候再挡一次。
const NAME_MAX = 80;
export function cleanName(value) {
  return cleanText(value, NAME_MAX);
}

// 分页名称配职业：完全相符才配，不分大小写、忽略前后空白。
// 只扫自己的键，所以 constructor、__proto__ 这类原型链名称不会误中。
export function jobFor(name, jobs) {
  if (typeof name !== "string") return null;
  const wanted = name.trim().toLowerCase();
  if (wanted === "") return null;
  if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs)) return null;
  for (const key of Object.keys(jobs)) {
    if (key.trim().toLowerCase() !== wanted) continue;
    const job = jobs[key];
    return typeof job === "string" && JOB_SET.has(job.trim()) ? job.trim() : null;
  }
  return null;
}

// 目前所有分页的名称，依画面顺序，再补只出现在 agents 的。新分页排在后面，旧分页就不会换人。
export function tabNames(spaces, agents) {
  return [
    ...(spaces ?? []).flatMap((s) => (s.tabs ?? []).map((t) => t.name)),
    ...(agents ?? []).map((a) => a.tab_name),
  ];
}

const nameKey = (name) => name.trim().toLowerCase();

// 配职业：jobs.json 有写的优先，其余依名称起算、跳过已被用掉的，八位都用完才重复。
export function assignJobs(names, jobs) {
  const list = [...new Set((names ?? []).filter((n) => typeof n === "string" && n.trim() !== "").map(nameKey))];
  const out = new Map();
  const used = new Set();
  for (const key of list) {
    const job = jobFor(key, jobs);
    if (job) { out.set(key, job); used.add(job); }
  }
  for (const key of list) {
    if (out.has(key)) continue;
    if (used.size >= JOBS.length) used.clear();
    const start = [...key].reduce((n, c) => n + c.codePointAt(0), 0);
    const job = Array.from({ length: JOBS.length }, (_, i) => JOBS[(start + i) % JOBS.length]).find((j) => !used.has(j));
    out.set(key, job);
    used.add(job);
  }
  return out;
}

export function jobIn(name, assigned) {
  return typeof name === "string" ? assigned.get(nameKey(name)) ?? null : null;
}

// image() 只读 Herdr 家目录的相对路径；只给已知角色，避免组出跳脱路径。
// 肖像：从 art/gugugaga/ 随机抽选（256x256 方图），同一个 tab/agent 固定同一张不闪烁。
export function portraitPath(job, key) {
  if (job === "gugugaga") return pick(key, "portrait", GUGUGAGA_POOLS.portrait);
  return null;
}

// 全身动图：依状态从 w/（工作）、b/（阻挡）、r/（其余）抽选，状态不变就不换图。
export function spritePath(job, status, key) {
  const state = status === "working" ? "working" : status === "blocked" ? "blocked" : "rest";
  if (job === "gugugaga") return pick(key, state, GUGUGAGA_POOLS[state]);
  return null;
}

// 与 gugugaga-agents 同步的程序/Agent 辨识表、像素 SVG Logo 与状态色票。
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

export function appLabel(app) {
  if (typeof app !== "string") return null;
  const key = app.trim().toLowerCase();
  const found = APPS.get(key);
  return found ? { ...found, key } : null;
}

export function resolveAppInfo(a) {
  const fromApp = appLabel(a?.app);
  if (fromApp) return fromApp;
  const fromKey = appLabel(a?.program?.key);
  if (fromKey) return fromKey;
  const progName = cleanText(a?.program?.name, 24);
  if (progName) {
    const lower = progName.toLowerCase();
    for (const [k, v] of APPS) {
      if (lower === k || lower.includes(k)) return { ...v, key: k };
    }
  }
  const fallbackName = progName || cleanText(a?.app, 24) || "Agent";
  return {
    key: cleanText(a?.app, 24) || cleanText(a?.program?.key, 24) || "agent",
    text: fallbackName,
    short: fallbackName,
    logo: a?.program?.icon || "mods/gugugaga-agents/art/logo-agent.svg",
    tint: Boolean(a?.program?.icon && a?.program?.tint),
    color: null,
  };
}

// 缓存只给本机终端；远程代号（vps/t7）没有本机文件。
export function cachePath(appHomeDir, address) {
  if (typeof appHomeDir !== "string") return null;
  const base = appHomeDir.replace(/\/+$/, "");
  if (base === "") return null;
  if (typeof address !== "string" || !LOCAL_ID.test(address)) return null;
  return `${base}/${SESSIONS_DIR}/${address}.json`;
}

// 远程 agent（imac/t1）：那台自己的 statusLine 写在它的默认 Herdr 文件夹，
// readTextFile 带 on 时相对路径从那台的家目录算起（2026-11-03 用 hc file read --on 实测）。
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function remoteCachePath(address) {
  if (typeof address !== "string") return null;
  const parts = address.split("/");
  if (parts.length !== 2 || !MACHINE.test(parts[0]) || !LOCAL_ID.test(parts[1])) return null;
  return { on: parts[0], path: `.config/herdr-app/${SESSIONS_DIR}/${parts[1]}.json` };
}

// 缓存内容：{ updatedAt, contextRemainingPct, fiveHourRemainingPct, sessionName }，数字、时间与 session 名称。
// 单一字段坏掉只让该字段变 null；updatedAt 不合法就整份当作读不到。
export function parseCache(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const updatedAt = data.updatedAt;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt < 0) return null;
  return {
    updatedAt,
    hp: pct(data.contextRemainingPct),
    sp: pct(data.fiveHourRemainingPct),
    name: cleanName(data.sessionName),
  };
}

// 一条 HP/SP 条要画的东西：没有数字（或没有时间戳）就显示「—」且不填色；
// 过旧只加标记，数字照实显示，不改写成别的值。
export function gauge(value, updatedAt, now) {
  const p = pct(value);
  const at =
    typeof updatedAt === "number" && Number.isFinite(updatedAt) && updatedAt >= 0
      ? updatedAt
      : null;
  if (p === null || at === null) return { text: "—", pct: null, stale: false };
  const stale = typeof now === "number" && Number.isFinite(now) && now - at > STALE_SECONDS;
  return { text: `${p}%`, pct: p, stale };
}
