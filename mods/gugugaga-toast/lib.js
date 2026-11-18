// 旅人通知 Toast MOD 的純函式：不碰 herdr / gpui-kit，可以被 node 直接載入測試。

export const JOBS = [
  // 本倉庫只發 gugugaga 一套素材；原 8 職業、maomeme/maid 與 dora 的圖已移到
  // ../archive-traveler-dora/ 備份，不再隨倉庫發佈。
  "gugugaga",
];

const JOB_SET = new Set(JOBS);

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

// 抽選快取：`key|state -> 檔名`。同一個 tab/agent 在同一狀態下永遠拿同一張，
// 只有狀態變了（key 不同）或檔案被刪除或模組重載才會重新隨機，避免每次 render 亂跳。
const PICKS = new Map();
export function resetPicks() { PICKS.clear(); }
function pick(key, state, pool) {
  if (!pool || pool.length === 0) return null;
  const k = `${key || "_"}|${state}`;
  const hit = PICKS.get(k);
  if (hit && pool.includes(hit)) return hit;
  for (const old of [...PICKS.keys()]) if (old.startsWith(`${key || "_"}|`)) PICKS.delete(old);
  const picked = pool[Math.floor(Math.random() * pool.length)];
  PICKS.set(k, picked);
  return picked;
}


export const withAlpha = (c, a) => (typeof c === "string" && c.startsWith("#") ? `${c.slice(0, 7)}${a}` : c);

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : [...s].slice(0, max).join("");
}

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

export function tabNames(spaces, agents) {
  return [
    ...(spaces ?? []).flatMap((s) => (s.tabs ?? []).map((t) => t.name)),
    ...(agents ?? []).map((a) => a.tab_name),
  ];
}

const nameKey = (name) => name.trim().toLowerCase();

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

const APPS = new Map([
  ["antigravity", { text: "Antigravity", short: "AGY", logo: "mods/gugugaga-agents/art/logo-antigravity.svg", color: "#38bdf8" }],
  ["pi", { text: "Pi", short: "pi", logo: "mods/gugugaga-agents/art/logo-pi.svg", color: "#38bdf8" }],
  ["claude-code", { text: "Claude", short: "Claude", logo: "mods/gugugaga-agents/art/logo-claude.svg", color: "#d97757" }],
  ["claude", { text: "Claude", short: "Claude", logo: "mods/gugugaga-agents/art/logo-claude.svg", color: "#d97757" }],
  ["codex", { text: "Codex", short: "Codex", logo: "mods/gugugaga-agents/art/logo-codex.svg", color: "#10a37f" }],
  ["opencode", { text: "OpenCode", short: "OpenCode", logo: "mods/gugugaga-agents/art/logo-opencode.svg", color: "#a78bfa" }],
  ["gemini", { text: "Gemini", short: "Gemini", logo: "mods/gugugaga-agents/art/logo-gemini.svg", color: "#60a5fa" }],
  ["gemini-cli", { text: "Gemini", short: "Gemini", logo: "mods/gugugaga-agents/art/logo-gemini.svg", color: "#60a5fa" }],
]);

export function appLabel(app) {
  if (typeof app !== "string") return null;
  const key = app.trim().toLowerCase();
  const found = APPS.get(key);
  return found ? { ...found, key } : null;
}

export function resolveToastApp({ app, program, title } = {}) {
  const fromApp = appLabel(app);
  if (fromApp) return fromApp;
  const fromKey = appLabel(program?.key);
  if (fromKey) return fromKey;
  const candidates = [cleanText(program?.name, 32), cleanText(title, 64)].filter(Boolean);
  for (const text of candidates) {
    const lower = text.toLowerCase();
    for (const [k, v] of APPS) {
      if (lower === k || new RegExp(`(?:^|\\W)${k}(?:$|\\W)`, "i").test(lower)) {
        return { ...v, key: k };
      }
    }
  }
  return null;
}

export function parseToastBody(body) {
  const raw = typeof body === "string" ? body : "";
  const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(raw);
  if (login) {
    return {
      loginMachine: login[1],
      command: `hc machine login ${login[1]}`,
      spaceName: null,
      tabName: null,
    };
  }
  if (raw !== "" && !raw.includes("\n")) {
    const parts = raw.split(" / ");
    if (parts.length === 2 && parts[0].trim() !== "" && parts[1].trim() !== "") {
      return {
        loginMachine: null,
        command: null,
        spaceName: parts[0].trim(),
        tabName: parts[1].trim(),
      };
    }
  }
  return { loginMachine: null, command: null, spaceName: null, tabName: null };
}

export function resolveToastStatus(level, title) {
  const t = typeof title === "string" ? title : "";
  if (level === "error") return { key: "blocked", label: "Alert", mark: "!" };
  if (level === "warning" || /\bneeds\b|\bblocked\b|\battention\b|\bwait/i.test(t)) {
    return { key: "blocked", label: "Needs you", mark: "!" };
  }
  if (level === "success" || /\bfinished\b|\bdone\b|\bcompleted\b|\bready\b/i.test(t)) {
    return { key: "done", label: "Done", mark: "✓" };
  }
  if (/\bworking\b|\brunning\b|\bstarted\b/i.test(t)) {
    return { key: "working", label: "Working", mark: "▘" };
  }
  return { key: "info", label: "Notice", mark: "◈" };
}

export function resolveToastContext({ props, spacesList, agentsList, panesList, jobs }) {
  const p = props ?? {};
  const parsed = parseToastBody(p.body);
  const args = p.action?.args ?? {};
  const allAgents = agentsList ?? [];
  const allSpaces = spacesList ?? [];
  const allPanes = panesList ?? [];

  const matchedAgent =
    (args.terminal ? allAgents.find((a) => a.address === args.terminal) : null) ??
    (parsed.spaceName && parsed.tabName
      ? allAgents.find(
          (a) =>
            String(a.space_name).trim() === parsed.spaceName &&
            (String(a.tab_name).trim() === parsed.tabName || String(a.tab_index) === parsed.tabName),
        )
      : null) ??
    null;

  let matchedSpace = allSpaces.find((s) => (args.space && s.id === args.space) || (parsed.spaceName && s.name === parsed.spaceName)) ?? null;
  let matchedTab = null;
  if (matchedAgent) {
    matchedSpace = allSpaces.find((s) => s.id === matchedAgent.space) ?? matchedSpace;
    matchedTab = matchedSpace?.tabs?.find((t) => t.id === matchedAgent.tab) ?? null;
  } else if (parsed.tabName) {
    const searchSpaces = matchedSpace ? [matchedSpace] : allSpaces;
    for (const s of searchSpaces) {
      const hit = (s.tabs ?? []).find((t) => String(t.name) === parsed.tabName || String(t.index) === parsed.tabName);
      if (hit) { matchedSpace = s; matchedTab = hit; break; }
    }
  } else if (args.tab) {
    for (const s of allSpaces) {
      const hit = (s.tabs ?? []).find((t) => t.id === args.tab);
      if (hit) { matchedSpace = s; matchedTab = hit; break; }
    }
  }

  const matchedPane =
    (matchedAgent ? allPanes.find((x) => x.pane === matchedAgent.pane) : null) ??
    (matchedTab ? allPanes.find((x) => x.tab === matchedTab.id && x.program?.agent) ?? allPanes.find((x) => x.tab === matchedTab.id) : null) ??
    null;

  const assigned = assignJobs(tabNames(allSpaces, allAgents), jobs);
  const rawTabName = matchedTab?.name ?? matchedAgent?.tab_name ?? parsed.tabName;
  const toastStatus = resolveToastStatus(p.level, p.title);
  // 依通知狀態抽全身圖（working / blocked / 其餘），以 tab 名快取避免閃爍。
  const jobKey = rawTabName ? String(rawTabName) : "";
  const sprite = jobKey ? spritePath(jobIn(jobKey, assigned), toastStatus.key, jobKey) : null;
  const portrait = sprite ? null : rawTabName ? portraitPath(jobIn(String(rawTabName), assigned), jobKey) : null;
  const appInfo = resolveToastApp({
    app: matchedAgent?.app ?? matchedPane?.app,
    program: matchedAgent?.program ?? matchedPane?.program,
    title: p.title,
  });

  const spaceLabel = matchedAgent?.space_name ?? matchedSpace?.name ?? parsed.spaceName;
  const tabText = rawTabName ? (/^\d+$/.test(String(rawTabName)) ? `#${rawTabName}` : String(rawTabName)) : null;

  return {
    parsed,
    status: toastStatus,
    sprite,
    portrait,
    appInfo,
    spaceLabel,
    tabText,
  };
}
