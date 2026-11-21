// 旅人卡片 MOD 的纯函数：不碰 herdr / gpui-kit，可以被 node 直接加载测试。
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

// 抽选缓存：`key|state -> 文件名`。每个 agent(address) 与状态各自独立缓存，
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

// 0–100 的有限数才算百分比，其余（含 null、字符串、超出范围）都当没有数据。
function pct(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

// 字符串字段：去掉控制字符与文本方向控制字符、收敛空白、去头尾，最多 max 字；
// 跟 scripts/traveler-statusline.mjs 同一套规则，读的时候再挡一次。
function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : [...s].slice(0, max).join("");
}

// session 名称（Claude Code 的 /rename）最多 80 字。
const NAME_MAX = 80;
export function cleanName(value) {
  return cleanText(value, NAME_MAX);
}

// 模型与 effort 名称比 session 名称短：卡片上一行放得下就好。
const MODEL_MAX = 40;
function cleanModel(value) {
  return cleanText(value, MODEL_MAX);
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

// 程序与 Agent 识别：看 agent 回报的 app（OSC 7501）或 program key/name，提供显示名、像素 Logo 与代表色。
const APPS = new Map([
  ["antigravity", { text: "Antigravity", short: "AGY", builder: true, cli: "antigravity", logo: "mods/gugugaga-agents/art/logo-antigravity.svg", color: "#38bdf8" }],
  ["pi", { text: "Pi", short: "pi", builder: true, cli: "pi", logo: "mods/gugugaga-agents/art/logo-pi.svg", color: "#00d4ff" }],
  ["claude-code", { text: "Claude", short: "Claude", builder: false, cli: "claude", logo: "mods/gugugaga-agents/art/logo-claude.svg", color: "#d97757" }],
  ["claude", { text: "Claude", short: "Claude", builder: false, cli: "claude", logo: "mods/gugugaga-agents/art/logo-claude.svg", color: "#d97757" }],
  ["codex", { text: "Codex", short: "Codex", builder: true, cli: "codex", logo: "mods/gugugaga-agents/art/logo-codex.svg", color: "#e5e7eb" }],
  ["opencode", { text: "OpenCode", short: "OpenCode", builder: true, cli: "opencode", logo: "mods/gugugaga-agents/art/logo-opencode.svg", color: "#fab283" }],
  ["gemini", { text: "Gemini", short: "Gemini", builder: true, cli: "gemini", logo: "mods/gugugaga-agents/art/logo-gemini.svg", color: "#7aa8ff" }],
  ["gemini-cli", { text: "Gemini", short: "Gemini", builder: true, cli: "gemini", logo: "mods/gugugaga-agents/art/logo-gemini.svg", color: "#7aa8ff" }],
  // 12x12 crispEdges 像素 SVG 全 CLI 统一使用
  ["hermes", { text: "Hermes", short: "Hermes", builder: true, cli: "hermes", logo: "mods/gugugaga-agents/art/logo-hermes.svg", color: "#eab354" }],
  ["qwen", { text: "Qwen", short: "Qwen", builder: true, cli: "qwen", logo: "mods/gugugaga-agents/art/logo-qwen.svg", color: "#7aa2ff" }],
  ["qwen-code", { text: "Qwen", short: "Qwen", builder: true, cli: "qwen", logo: "mods/gugugaga-agents/art/logo-qwen.svg", color: "#7aa2ff" }],
  ["kimi", { text: "Kimi", short: "Kimi", builder: true, cli: "kimi", logo: "mods/gugugaga-agents/art/logo-kimi.svg", color: "#e2e8f0" }],
  ["kimi-code", { text: "Kimi", short: "Kimi", builder: true, cli: "kimi", logo: "mods/gugugaga-agents/art/logo-kimi.svg", color: "#e2e8f0" }],
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
    builder: true,
    cli: "unknown",
    glyph: null,
    logo: a?.program?.icon || "mods/gugugaga-agents/art/logo-agent.svg",
    tint: Boolean(a?.program?.icon && a?.program?.tint),
    color: null,
  };
}

// 解析终端画面最后几行的模型与思考强度（无 session 缓存时作为 fallback）。
export function parseTerminalModel(screenText, appKey) {
  if (typeof screenText !== "string" || screenText.trim() === "") return null;
  const lines = screenText
    .split(/\r?\n/)
    .map((l) => l.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, "").trimEnd())
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("[hc]"));
  if (lines.length === 0) return null;

  const tail = lines.slice(-6);
  const EFFORT_RE = /^(low|medium|high|max|minimal|auto|xhigh)$/i;

  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i];
    const agy = line.match(/\b(?:auto|manual)\s*·\s*([^\r\n│]+?)\s*$/i);
    if (agy) {
      const raw = agy[1].trim();
      const parts = raw.split(/\s*[·•]\s*/).filter(Boolean);
      const k = parts.findIndex((p, idx) => idx >= 1 && EFFORT_RE.test(p));
      let effort = null;
      let modelParts;
      if (k >= 1) {
        effort = cleanModel(parts[k].toLowerCase());
        modelParts = parts.slice(0, k);
      } else {
        modelParts = parts.filter((p) => !/task|\/tasks|^\d+\s/i.test(p));
      }
      const model = cleanModel(modelParts.join(" · "));
      if (model) return { model, effort };
    }

    const pi = line.match(/(?:\([^)\r\n]+\)\s*)?([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\s*[•·]\s*(low|medium|high|max|minimal|auto|xhigh)\b/i);
    if (pi) {
      let rawModel = pi[1];
      if (rawModel.length > 20 && rawModel.includes("/")) {
        rawModel = rawModel.slice(rawModel.indexOf("/") + 1);
      }
      const model = cleanModel(rawModel);
      const effort = cleanModel(pi[2].toLowerCase());
      if (model) return { model, effort };
    }
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const agyBanner = line.match(/(Gemini\s+\d+[^\r\n(]+?)\s*\((Low|Medium|High|Max|Minimal)\)/i);
    if (agyBanner) {
      return { model: cleanModel(agyBanner[1]), effort: cleanModel(agyBanner[2].toLowerCase()) };
    }
    if (appKey === "antigravity" || line.includes("Orchestrator")) {
      const orch = line.match(/\b(Orchestrator\s*\([^)\r\n]+\))/i);
      if (orch) return { model: cleanModel(orch[1]), effort: null };
    }
    const generic = line.match(/\b(claude-[a-z0-9.-]+|(?:Claude\s+)?(?:Opus|Sonnet|Haiku)\s+\d+(?:\.\d+)?|gpt-\d[a-z0-9.-]*|o[134](?:-[a-z0-9.-]+)?|gemini-\d[a-z0-9.-]*|deepseek-[a-z0-9.-]+)\b/i);
    if (generic) {
      return { model: cleanModel(generic[1]), effort: null };
    }
  }
  return null;
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

// 缓存内容：{ updatedAt, contextRemainingPct, fiveHourRemainingPct, sessionName, model, effort }。
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
    model: cleanModel(data.model),
    effort: cleanModel(data.effort),
  };
}

// 卡片上的「模型 · effort」一行：没有模型就不显示（effort 单独出现没有意义）。
export function modelText(model, effort) {
  const m = cleanModel(model);
  if (m === null) return null;
  const e = cleanModel(effort);
  if (e === null) return m;
  const shortEffort = e.toLowerCase() === "medium" ? "med" : e;
  return `${m} · ${shortEffort}`;
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

// ── 模型家族：卡片右侧立绘、主题色与名字都依模型家族决定 ────────────────────
// art 是相对 Herdr 家目录的路径，图档按家族放在 mods/gugugaga-agents/art/models/<family>/。
// 色板依 agy-c 的「Gugugaga 冰夜像素铭牌」规范：primary 是模型主色，
// plate 是框底混色，frame / hover 是粗框常态与悬停色。
export const MODEL_FAMILIES = {
  deepseek: { label: "DeepSeek", primary: "#4fa8ff", plate: "#0f1b2e", frame: "#264163", hover: "#3f6fa3", art: "mods/gugugaga-agents/art/models/deepseek/deepseek.png", vendorLogo: "mods/gugugaga-agents/art/vendors/deepseek.svg" },
  gpt: { label: "ChatGPT", primary: "#98e2d8", plate: "#111e24", frame: "#2b454c", hover: "#4d7d82", art: "mods/gugugaga-agents/art/models/gpt/chatgpt.png", vendorLogo: "mods/gugugaga-agents/art/vendors/gpt.svg" },
  claude: { label: "Claude", primary: "#e88b5a", plate: "#1c161d", frame: "#4a3533", hover: "#7d5244", art: "mods/gugugaga-agents/art/models/claude/claude.png", vendorLogo: "mods/gugugaga-agents/art/vendors/claude.svg" },
  gemini: { label: "Gemini", primary: "#9d96ff", plate: "#141529", frame: "#33355c", hover: "#595a94", art: "mods/gugugaga-agents/art/models/gemini/gemini.png", vendorLogo: "mods/gugugaga-agents/art/vendors/gemini.svg" },
  glm: { label: "GLM", primary: "#a6bdd4", plate: "#151c27", frame: "#344254", hover: "#576d87", art: "mods/gugugaga-agents/art/models/glm/glm.png", vendorLogo: "mods/gugugaga-agents/art/vendors/glm.svg", moon: true },
  grok: { label: "Grok", primary: "#e86f82", plate: "#1d131c", frame: "#4d2d3b", hover: "#82475a", art: "mods/gugugaga-agents/art/models/grok/grok.png", vendorLogo: "mods/gugugaga-agents/art/vendors/grok.svg" },
  kimi: { label: "Kimi", primary: "#c6b8ff", plate: "#151624", frame: "#383854", hover: "#605e8a", art: "mods/gugugaga-agents/art/models/kimi/kimi.png", vendorLogo: "mods/gugugaga-agents/art/vendors/kimi.svg" },
  qwen: { label: "Qwen", primary: "#6f96ff", plate: "#11182c", frame: "#2a3a61", hover: "#48629e", art: "mods/gugugaga-agents/art/models/qwen/qwen.png", vendorLogo: "mods/gugugaga-agents/art/vendors/qwen.svg" },
};

// 认不出模型时的兜底色与咕咕嘎嘎立绘：沿用 gugugaga-ice 的冰蓝与企鹅兜底图。
export const UNKNOWN_FAMILY = { key: "unknown", label: "Agent", primary: "#8ccaff", plate: "#111926", frame: "#2a3a50", hover: "#4a6486", art: "mods/gugugaga-agents/art/models/unknown/gugugaga.png", vendorLogo: "mods/gugugaga-agents/art/vendors/agent.svg" };

// 模型立绘动态资源池：启动与文件夹异动时由 main.js 扫描 art/models/<family>/ 覆盖，
// 与左侧 gugugaga 动图一样使用 PICKS 随机抽选；立绘为静态图，仅在切换模型或增删文件时生效。
export const MODEL_POOL_KEYS = [...Object.keys(MODEL_FAMILIES), UNKNOWN_FAMILY.key];
let MODEL_POOLS = Object.fromEntries(
  MODEL_POOL_KEYS.map((k) => [k, [(MODEL_FAMILIES[k] ?? UNKNOWN_FAMILY).art]]),
);
export function setModelPools(next) {
  if (!next || typeof next !== "object") return;
  for (const k of MODEL_POOL_KEYS) {
    if (Array.isArray(next[k])) MODEL_POOLS[k] = next[k];
  }
}

// 认模型字符串：顺序有意义（claude 先于 gpt，免得 o1 之类的片段误判）。
const FAMILY_RULES = [
  ["deepseek", /(?:^|[\s/_-])deepseek/i],
  ["claude", /claude|(?:^|[\s/_-])(?:opus|sonnet|haiku)(?:[\s/_-]|$)/i],
  ["gemini", /gemini|gemma/i],
  ["glm", /(?:^|[\s/_-])(?:glm|chatglm|codegeex)(?:[\s/_-]|$)|zhipu/i],
  ["grok", /(?:^|[\s/_-])grok/i],
  ["kimi", /(?:^|[\s/_-])kimi|moonshot/i],
  ["qwen", /(?:^|[\s/_-])qwen|tongyi/i],
  ["gpt", /chatgpt|(?:^|[\s/_-])gpt|(?:^|[\s/_-])o[134](?:[\s/_.-]|$)|davinci|codex/i],
];

// app 当线索：没有模型字符串时（例如还没读到 statusLine）至少能猜到家族。
const APP_FAMILY = {
  "claude-code": "claude",
  claude: "claude",
  codex: "gpt",
  gemini: "gemini",
  "gemini-cli": "gemini",
};

// model 可以是 null；appKey 可省略。认不出来就回 null，调用端用 Agent 自己的色。
export function modelFamily(model, appKey) {
  const s = typeof model === "string" ? model : "";
  for (const [key, re] of FAMILY_RULES) {
    if (re.test(s)) return { key, ...MODEL_FAMILIES[key] };
  }
  const app = typeof appKey === "string" ? appKey.trim().toLowerCase() : "";
  const fromApp = APP_FAMILY[app];
  if (fromApp) return { key: fromApp, ...MODEL_FAMILIES[fromApp] };
  return { ...UNKNOWN_FAMILY };
}

// 立绘路径：依模型家族从资源池随机抽选，同一个 agent 与模型家族缓存同一张不闪烁，
// 家族有图才回传，没有就 null（卡片留空，不画破图）。
export function modelArtForFamily(familyKey, key) {
  const k = typeof familyKey === "string" && MODEL_POOLS[familyKey] ? familyKey : UNKNOWN_FAMILY.key;
  return pick(key, `model:${k}`, MODEL_POOLS[k]);
}

export function modelArt(model, appKey, key) {
  return modelArtForFamily(modelFamily(model, appKey).key, key);
}

// 模型字符串有时带 provider 前缀（anthropic/claude-sonnet-4）与尾部日期戳
// （-20250929）；太长才切前缀，日期戳一律剥掉。完整原名另由调用端保留给 tooltip。
const DATE_STAMP = /[-_](?:19|20)\d{6}$/;
export function modelLabel(model) {
  let m = cleanModel(model);
  if (m === null) return null;
  m = m.replace(DATE_STAMP, "");
  if (m.length <= 20) return m;
  const cut = m.lastIndexOf("/");
  return cut >= 0 && cut < m.length - 1 ? m.slice(cut + 1) : m;
}

// 思考强度像素格规：回传 5 格亮灭数组与大写等宽标签；无 effort 回传 null。
const EFFORT_SPECS = {
  minimal: { cells: [true, false, false, false, false], label: "MIN" },
  low:     { cells: [true, true, false, false, false], label: "LOW" },
  medium:  { cells: [true, true, true, false, false], label: "MED" },
  high:    { cells: [true, true, true, true, false], label: "HIGH" },
  xhigh:   { cells: [true, true, true, true, true], label: "XHIGH" },
  max:     { cells: [true, true, true, true, true], label: "MAX" },
  auto:    { cells: [true, false, true, false, true], label: "AUTO" },
};

export function effortSpec(effort) {
  const e = cleanModel(effort);
  if (e === null) return null;
  const key = e.toLowerCase();
  if (EFFORT_SPECS[key]) return EFFORT_SPECS[key];
  return { cells: [true, true, true, false, false], label: key.toUpperCase() };
}

// 副标上下文名称：优先取自订 session 名称（cache.name），其次取非纯数字且不与 space 重复的 tab_name。
export function contextLabel(cacheName, tabName, { model = null, rawModel = null, spaceName = null } = {}) {
  const sameAs = (v, other) =>
    typeof other === "string" && other.trim() !== "" && v.toLowerCase() === other.trim().toLowerCase();
  const c = cleanName(cacheName);
  if (c && !sameAs(c, model) && !sameAs(c, rawModel)) return c;
  const t = cleanName(tabName);
  if (t && !/^#?\d+$/.test(t) && !sameAs(t, spaceName) && !sameAs(t, model) && !sameAs(t, rawModel)) return t;
  return null;
}

// ── Space 建筑图标：跟 gugugaga-spaces 同一套规则（places.json 优先，否则名称哈希）──
export const GUGUGAGA_PLACES = ["igloo", "lighthouse", "fishshop", "iceberg"];

// 回传 place 名称；recognized 之外的一律依名称固定配一个，排序不会换。
export function spacePlace(name, places) {
  const n = typeof name === "string" && name !== "" ? name : "~";
  const picked = places && typeof places === "object" ? places[n] : null;
  if (GUGUGAGA_PLACES.includes(picked)) return picked;
  const sum = [...n].reduce((acc, c) => acc + c.codePointAt(0), 0);
  return GUGUGAGA_PLACES[sum % GUGUGAGA_PLACES.length];
}

export function spacePlaceArt(name, places) {
  return `mods/gugugaga-spaces/art/gugugaga/${spacePlace(name, places)}.png`;
}

// ── Agent CLI 皮肤：外框/底面/羽化/侧脊归 CLI，立绘/模型色归 Model ──────────
// 纯数据表，main.js 依 style 画框；三态索引 index 0=default / 1=hovered / 2=focused。
// frameBorder + cabinInset 恒等于 3：任何流派都保住内舱 234x90、立绘 112x90。
export const CLI_SKINS = {
  antigravity: {
    style: "ring", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#101526",
    ring: { from: "#6366f1", to: "#38bdf8", angle: 135 },
    innerLine: ["#38bdf81c", "#38bdf844", "#38bdf866"],
    brightness: [0.34, 0.66, 1.0],
    pixelCorners: ["#38bdf840", "#38bdf899", "#38bdf8ee"],
    spine: { kind: "segments", colors: ["#38bdf8", "#6366f1"], state: ["5c", "aa", "ff"] },
    accent: "#38bdf8",
  },
  pi: {
    style: "dashed", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#0b151e",
    dashed: ["#00aaff2a", "#00aaff66", "#00ffff99"],
    corner: ["#00aaff52", "#00ccffaa", "#00ffffff"],
    noSpine: true,
    accent: "#00d4ff",
  },
  claude: {
    style: "double", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#151413",
    outer: ["#d977573a", "#d9775790", "#d97757f0"],
    inner: ["#d977571a", "#d977573c", "#d9775766"],
    spine: { kind: "solid", colors: ["#d9775754", "#d9775799", "#d97757f0"] },
    cornerDots: true,
    bottomRight: "✻",
    bottomRightColor: ["#d9775744", "#d9775788", "#d97757cc"],
    accent: "#d97757",
  },
  gemini: {
    style: "ring", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#111424",
    ring: { from: "#4796e4", to: "#c3677f", angle: 135 },
    innerLine: ["#847ace1f", "#847ace48", "#847ace77"],
    brightness: [0.34, 0.66, 1.0],
    pixelCorners: ["#4796e448", "#7aa8ff9e", "#c3677fee"],
    spine: { kind: "solid", colors: ["#4796e45e", "#7aa8ffaa", "#847aceff"] },
    stars: ["#4796e4cc", "#c3677fcc"],
    accent: "#7aa8ff",
  },
  opencode: {
    style: "solid", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#141517",
    outer: ["#202328", "#3b414a", "#6e7681"],
    leftBar: ["#fab2835e", "#fab283bb", "#fab283ff"],
    pixelCorners: ["#fab28338", "#fab28388", "#fab283dd"],
    noSpine: true,
    accent: "#fab283",
  },
  codex: {
    style: "double", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#0e0f11",
    outer: ["#ffffff1e", "#ffffff54", "#ffffffcc"],
    inner: ["#ffffff0c", "#ffffff1e", "#ffffff38"],
    cornerDots: true,
    noSpine: true,
    accent: "#e5e7eb",
  },
  hermes: {
    style: "ornate", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#17130e",
    outer: ["#cd7f324d", "#cd7f329c", "#e09b4aff"],
    inner: ["#ffd7001f", "#ffd70044", "#ffd70088"],
    spine: { kind: "solid", colors: ["#ffd70032", "#ffd70066", "#ffd70099"] },
    cornerMotif: true,
    accent: "#eab354",
  },
  qwen: {
    style: "ring", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#101526",
    ring: { from: "#6366f1", to: "#60a5fa", angle: 135 },
    innerLine: ["#60a5fa1c", "#60a5fa3c", "#60a5fa66"],
    brightness: [0.34, 0.66, 1.0],
    pixelCorners: ["#6366f148", "#6f96ff9e", "#60a5faee"],
    spine: { kind: "solid", colors: ["#6366f15e", "#6f96ffaa", "#60a5faff"] },
    bottomRight: "✧",
    bottomRightColor: ["#60a5fa54", "#60a5fa99", "#60a5facc"],
    accent: "#7aa2ff",
  },
  kimi: {
    style: "hairline", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#0d0e13",
    line: ["#dbeafe2a", "#dbeafe6e", "#eff6ffe6"],
    pixelCorners: ["#dbeafe30", "#dbeafe80", "#eff6ffdd"],
    bottomRight: "☾",
    bottomRightColor: ["#cbd5e15e", "#cbd5e199", "#cbd5e1bb"],
    noSpine: true,
    accent: "#e2e8f0",
  },
  unknown: {
    style: "solid", radius: 0, chipRadius: 0, ink: "#070b12",
    plate: "#111926",
    outer: ["#1c2738", "#3d5575", "#8ccaff"],
    spine: { kind: "solid", colors: ["#8ccaff30", "#8ccaff70", "#8ccaffcc"] },
    nails: true,
    accent: "#8ccaff",
  },
};

export function cliSkin(key) {
  const k = typeof key === "string" ? key.trim().toLowerCase() : "";
  return CLI_SKINS[k] ?? CLI_SKINS.unknown;
}

// 流派外框厚度与内舱缩进。GPUI 的 absolute().inset(N) 从外边框盒起算，
// 所以粗骨派（solid/ornate）要用更大的 inset 才不会让内舱盖掉第 2px 边框。
export const CLI_FRAME = {
  ring: { border: 1, cabinInset: 2 },
  double: { border: 1, cabinInset: 2 },
  dashed: { border: 0, cabinInset: 3 },
  ornate: { border: 2, cabinInset: 3 },
  solid: { border: 2, cabinInset: 2 },
  hairline: { border: 1, cabinInset: 2 },
};

export function cliFrame(style) {
  return CLI_FRAME[style] ?? CLI_FRAME.ring;
}

// 两色线性混合（t=0 → a，t=1 → b），回传 #rrggbb。给不吃 alpha 的实色零件用。
export function mixHex(a, b, t) {
  const parse = (c) => {
    const s = String(c).replace("#", "");
    if (s.length !== 6 && s.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return a;
  const k = Math.min(1, Math.max(0, Number(t) || 0));
  return (
    "#" +
    pa
      .map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, "0"))
      .join("")
  );
}
