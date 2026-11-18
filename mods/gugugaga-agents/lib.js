// 旅人卡片 MOD 的純函式：不碰 herdr / gpui-kit，可以被 node 直接載入測試。
// 這裡只做資料處理；讀快取、畫畫面都在 main.js。

export const JOBS = [
  // 本倉庫只發 gugugaga 一套素材；原 8 職業、maomeme/maid 與 dora 的圖已移到
  // ../archive-traveler-dora/ 備份，不再隨倉庫發佈。
  "gugugaga",
];

// 快取超過這麼久就標「舊」：statusLine 每次回應都會重寫，5 分鐘沒動就不算即時。
export const STALE_SECONDS = 300;

const JOB_SET = new Set(JOBS);
const SESSIONS_DIR = "data/traveler/sessions";

// 動態資源池：預設用已知清單兜底，啟動與資料夾異動時由 main.js 透過 readdir 覆蓋，
// 確保手動增刪 art/gugugaga 或 sprites/gugugaga/{r,w,b} 檔案時不會抽到已刪除的圖。
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

// 抽選快取：`key|state -> 檔名`。每個 agent(address) 與狀態各自獨立快取，
// 互不影響；只有該檔案被手動刪除或模組重載時才會重新隨機。
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


// 本機終端機代號：跟 scripts/traveler-statusline.mjs 寫檔名的規則一致，不收路徑字元。
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// 0–100 的有限數才算百分比，其餘（含 null、字串、超出範圍）都當沒有資料。
function pct(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

// 字串欄位：去掉控制字元與文字方向控制字元、收斂空白、去頭尾，最多 max 字；
// 跟 scripts/traveler-statusline.mjs 同一套規則，讀的時候再擋一次。
function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : [...s].slice(0, max).join("");
}

// session 名稱（Claude Code 的 /rename）最多 80 字。
const NAME_MAX = 80;
export function cleanName(value) {
  return cleanText(value, NAME_MAX);
}

// 模型與 effort 名稱比 session 名稱短：卡片上一行放得下就好。
const MODEL_MAX = 40;
function cleanModel(value) {
  return cleanText(value, MODEL_MAX);
}

// 分頁名稱配職業：完全相符才配，不分大小寫、忽略前後空白。
// 只掃自己的鍵，所以 constructor、__proto__ 這類原型鏈名稱不會誤中。
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

// 目前所有分頁的名稱，依畫面順序，再補只出現在 agents 的。新分頁排在後面，舊分頁就不會換人。
export function tabNames(spaces, agents) {
  return [
    ...(spaces ?? []).flatMap((s) => (s.tabs ?? []).map((t) => t.name)),
    ...(agents ?? []).map((a) => a.tab_name),
  ];
}

const nameKey = (name) => name.trim().toLowerCase();

// 配職業：jobs.json 有寫的優先，其餘依名稱起算、跳過已被用掉的，八位都用完才重複。
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

// image() 只讀 Herdr 家目錄的相對路徑；只給已知角色，避免組出跳脫路徑。
// 肖像：從 art/gugugaga/ 隨機抽選（256x256 方圖），同一個 tab/agent 固定同一張不閃爍。
export function portraitPath(job, key) {
  if (job === "gugugaga") return pick(key, "portrait", GUGUGAGA_POOLS.portrait);
  return null;
}

// 全身動圖：依狀態從 w/（工作）、b/（阻擋）、r/（其餘）抽選，狀態不變就不換圖。
export function spritePath(job, status, key) {
  const state = status === "working" ? "working" : status === "blocked" ? "blocked" : "rest";
  if (job === "gugugaga") return pick(key, state, GUGUGAGA_POOLS[state]);
  return null;
}

// 程式與 Agent 識別：看 agent 回報的 app（OSC 7501）或 program key/name，提供顯示名、像素 Logo 与代表色。
const APPS = new Map([
  ["antigravity", { text: "Antigravity", short: "AGY", builder: true, logo: "mods/gugugaga-agents/art/logo-antigravity.svg", color: "#38bdf8" }],
  ["pi", { text: "Pi", short: "pi", builder: true, logo: "mods/gugugaga-agents/art/logo-pi.svg", color: "#38bdf8" }],
  ["claude-code", { text: "Claude", short: "Claude", builder: false, logo: "mods/gugugaga-agents/art/logo-claude.svg", color: "#d97757" }],
  ["claude", { text: "Claude", short: "Claude", builder: false, logo: "mods/gugugaga-agents/art/logo-claude.svg", color: "#d97757" }],
  ["codex", { text: "Codex", short: "Codex", builder: true, logo: "mods/gugugaga-agents/art/logo-codex.svg", color: "#10a37f" }],
  ["opencode", { text: "OpenCode", short: "OpenCode", builder: true, logo: "mods/gugugaga-agents/art/logo-opencode.svg", color: "#a78bfa" }],
  ["gemini", { text: "Gemini", short: "Gemini", builder: true, logo: "mods/gugugaga-agents/art/logo-gemini.svg", color: "#60a5fa" }],
  ["gemini-cli", { text: "Gemini", short: "Gemini", builder: true, logo: "mods/gugugaga-agents/art/logo-gemini.svg", color: "#60a5fa" }],
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
    logo: a?.program?.icon || "mods/gugugaga-agents/art/logo-agent.svg",
    tint: Boolean(a?.program?.icon && a?.program?.tint),
    color: null,
  };
}

// 解析終端畫面最後幾行的模型與思考強度（無 session 快取時作为 fallback）。
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

// 快取只給本機終端機；遠端代號（vps/t7）沒有本機檔案。
export function cachePath(appHomeDir, address) {
  if (typeof appHomeDir !== "string") return null;
  const base = appHomeDir.replace(/\/+$/, "");
  if (base === "") return null;
  if (typeof address !== "string" || !LOCAL_ID.test(address)) return null;
  return `${base}/${SESSIONS_DIR}/${address}.json`;
}

// 遠端 agent（imac/t1）：那台自己的 statusLine 寫在它的預設 Herdr 資料夾，
// readTextFile 帶 on 時相對路徑從那台的家目錄算起（2026-11-03 用 hc file read --on 實測）。
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function remoteCachePath(address) {
  if (typeof address !== "string") return null;
  const parts = address.split("/");
  if (parts.length !== 2 || !MACHINE.test(parts[0]) || !LOCAL_ID.test(parts[1])) return null;
  return { on: parts[0], path: `.config/herdr-app/${SESSIONS_DIR}/${parts[1]}.json` };
}

// 快取內容：{ updatedAt, contextRemainingPct, fiveHourRemainingPct, sessionName, model, effort }。
// 單一欄位壞掉只讓該欄位變 null；updatedAt 不合法就整份當作讀不到。
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

// 卡片上的「模型 · effort」一行：沒有模型就不顯示（effort 單獨出現沒有意義）。
export function modelText(model, effort) {
  const m = cleanModel(model);
  if (m === null) return null;
  const e = cleanModel(effort);
  if (e === null) return m;
  const shortEffort = e.toLowerCase() === "medium" ? "med" : e;
  return `${m} · ${shortEffort}`;
}

// 一條 HP/SP 條要畫的東西：沒有數字（或沒有時間戳）就顯示「—」且不填色；
// 過舊只加標記，數字照實顯示，不改寫成別的值。
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
