# AGENTS.md — `layout-gugugaga` Project Entry & Architecture Index

> **Audience**: AI coding agents (`agy`, `pi`, `claude`, `codex`, `opencode`, `hermes`, etc.) working inside `layout-gugugaga`.
> Read this index **before** grepping the repository so you can jump directly to the exact file, constant, or constraint you need.

---

## 1. Overview

`layout-gugugaga` is an **Obsidian Pixel Deck** layout, theme, and mod suite for **Herdr** (`herdr-app`), targeting Windows first with macOS awareness. It combines a deep neutral obsidian pixel cockpit (`rounded(0)`, `Cascadia Mono` uppercase badges, `2×2` corner studs) with 3-state *Gugugaga* penguin sprites, 10 CLI frame skins × 8 model-family portraits, 4-tier responsive sidebar shrinking, a custom `28px` split-terminal pane header, and an integrated `Files` / `Changes` / `Inbox` right-hand drawer.

---

## 2. Repository Map & Code Anchors

| Component | Entry & Core Files | Key Responsibilities, Constants & Anchors |
| :--- | :--- | :--- |
| **Layout** | `layouts/gugugaga.json` | Root row (`theme: "gugugaga-obsidian"`, `toast: "gugugaga-toast"`, `terminal_padding: [12, 10]`, `terminal_opacity: 1`).<br>Left `sidebar`: `320px`, `min: 44`, `max: 480`, `resizable: true`, no background image.<br>Center `work-body`: `padding: 6`, `gap: 6`; `pane`: `mod: "gugugaga-pane"`, `height: 28`, `border: 1 #232a36`, `focus: 1 accent`, `radius: 0`, `gap: 6`.<br>Right `panel`: `368px` (`min: 280`, `max: 900`, `hidden: true`), stack `panel-body` (`files`, `changes` → `gugugaga-files`; `inbox` → `inbox`). |
| **Themes** | `themes/gugugaga-obsidian.json`<br>`themes/gugugaga-ice.json` | Active theme: `gugugaga-obsidian`. Legacy `gugugaga-ice` is kept untouched for backward compatibility with older user settings. |
| **Agents (`Party`)** | `mods/gugugaga-agents/main.js`<br>`mods/gugugaga-agents/lib.js` | `main.js`: `CARD_H=109`, `CARD_GAP=8`, `LEFT_W=56`, `PLATE_X=64`, `NARROW_PX=160`. Dynamic `plateW = clamp(round(panelW - 16 - PLATE_X), 80, 320)` where `panelW = size.width / zoom`.<br>4 responsive tiers: `>=272` full showcase; `228..272` portrait collapsed; `160..228` compact plate (badge anti-collision at `plateW < 192` / `< 156`, dynamic `notchW` & `workingTrack`); `<160` penguin rail. `Party [n]` header includes `320 ↔ 196` quick toggle.<br>`lib.js`: `APPS` (9+ CLIs), `CLI_SKINS` (10 frame styles), `CLI_FRAME`, `MODEL_FAMILIES` (8 models + `UNKNOWN_FAMILY`), `effortSpec()`, `parseTerminalModel()`, `assignJobs()`, `spacePlaceArt()`.<br>Assets: `art/gugugaga/a1..a7.png` (256×256), `sprites/gugugaga/{r,w,b}/*.gif` (144×192 drawn 48×64), `art/models/*.png` (224×180 drawn 112×90), `art/vendors/*.svg`, `art/logo-*.svg`. |
| **Spaces** | `mods/gugugaga-spaces/main.js` | Machine outliner + space cards + git polling (`git status --porcelain=v2 --branch`).<br>Neutral charcoal trunk/branches (`#3a4559`/`#2b3444`); only active space branch & `7×7` node light up `t.accent`.<br>Responsive narrowing (`blockW = size.width / zoom`): `< 230` shrinks building slot `46→34` (image `42→30`) and hides per-machine `+` button; `< 160` enters `compact()` rail. Optional untracked `places.json` overrides `art/gugugaga/{igloo,lighthouse,fishshop,iceberg}.png`. |
| **Tabs & Top Buttons** | `mods/gugugaga-tabs/main.js`<br>`mods/gugugaga-tabs/lib.js` | `58px` bar: `48px` `rounded(0)` tabs with `2px` CLI/blocked top strip & bottom `2×2` studs, `Cascadia Mono` uppercase `STATUS_SKIN` pills (`WORKING` / `NEEDS YOU` / `DONE` / `IDLE`).<br>Top-right partitioned buttons: `+ \| FILES · CHANGES · INBOX \| win controls` using 14×14 monochrome SVGs from `mods/gugugaga-chrome/{files,git-compare,archive}.svg`.<br>`syncPanel()` persists per-space active drawer in `localStorage["panels"]`. |
| **Chrome** | `mods/gugugaga-chrome/main.js` | Dual role via `props().footer`: `46px` brand strip (`24×24` square avatar slot, `picker`, `toggleSidebar`) or `69px` footer (`Settings`, `Add machine`). Solid `t.chrome`, `rounded(0)`. Owns `30` monochrome `.svg` icons. |
| **Split Pane Header** | `mods/gugugaga-pane/main.js`<br>`mods/gugugaga-pane/lib.js` | `28px` custom pane header (`mod.json`: `{"place":"none"}`): `2px` top bar (`blocked` pulsing amber > `focused` CLI color), `focused` `2×2` corner studs, `16×16` CLI slot, `t1xx` address badge, last folder + optional branch (`paneW >= 360`), `2×3` pixel dot grip when `p.movable` (non-intercepting), `↓N` scroll-bottom chip, `STATUS_SKIN` pill (`< 280` icon-only), `[Z]` zoomed badge, hover `20×20` split/zoom/close buttons. |
| **Files & Changes** | `mods/gugugaga-files/main.js`<br>`files.js`, `changes.js`, `menu.js`, `actions.js` | Integrated from `files-and-changes-addon` (derived from Herdr 0.1.16 `Apache-2.0`). Dispatches by `props.panel` (`"files"` / `"changes"`) or `props.role === "menu"`.<br>`files.js`: tree + git marks + `EditorState` with `soft_wrap: true`.<br>`changes.js`: virtual diff + persistent `WRAP` toggle (`localStorage["gugugaga-files/wrap"]`, fallback `files-and-changes-addon/wrap`) + `zoom`-corrected `measure()` + `t.accent` `COMMIT` button.<br>`actions.js` + `menu.js`: `MOD = "gugugaga-files"`, `openOverlay({ ..., frame: "none" })`, keyboard-navigable (`↑/↓/Enter/Esc`) open/reveal popup. |
| **Toast** | `mods/gugugaga-toast/main.js`<br>`mods/gugugaga-toast/lib.js` | Pixel nameplate notification overlay (`"toast": "gugugaga-toast"`): `rounded(0)`, `2px` top bar, `2×2` corner studs, `STATUS_SKIN` uppercase badge, one-click remote `hc machine login` command copy. |
| **Inbox** | `mods/inbox/main.js`<br>`mods/inbox/lib.js` | `data/inbox/files` watcher; OneDrive-safe Desktop copy (`cp -n` / `Test-Path`) & Recycle Bin trash (`SendToRecycleBin`). Styled to match `gugugaga-files` (`h(36)` header, `border_1`, `rounded(0)` rows & type-colored badges). |

---

## 3. Design System Invariants (Obsidian Pixel Deck)

1. **Color Palette (`themes/gugugaga-obsidian.json`)**:
   - Canvas: `#07090d` | Terminal BG: `#0b0e14` | Chrome / Surface / Popover: `#10141c` | Raised / Input: `#171c26`
   - Neutral Border: `#232a36` | Text: `#e6ebf2` (fg), `#94a0b2` (muted), `#5c6676` (dim)
   - Active/Working Accent: `#38bdf8` (`selected: #38bdf81c`, `selection: #1d2d44`)
   - Blocked/Alert Signal: `#ffb547` (`solid` / `blocked`) — **NEVER use `#ffb547` for normal active/focus/commit UI**; it is strictly reserved for `NEEDS YOU` / `blocked`.
   - Done: `#6ee7b7` | Idle: `#525d6e` | Unknown: `#a78bfa`
2. **Geometry & Typography**:
   - **Zero corner radius everywhere**: always `.rounded(0)` (and `"radius": 0` in layout pane config).
   - Badges, counters (`[n]`), pane addresses (`t125`), and status pills (`WORKING` / `NEEDS YOU` / `DONE` / `IDLE`) use `Cascadia Mono` uppercase.
3. **Drawer Header Parity**:
   - `FILES`, `CHANGES`, and `INBOX` all share `border_1().border_color(t.border)` + `h(36)` header (`px(14).gap(8).border_b(1)`) so switching stack tabs causes zero 1px shift.

---

## 4. Cross-Mod Sync & Known Gotchas

- **`on_size_change` returns scaled pixels**: Under UI zoom (e.g. `1.2×`), `size.width` is scaled. Always divide by `(settings().zoom > 0 ? settings().zoom : 1)` before comparing breakpoints (`gugugaga-agents`, `gugugaga-spaces`, `gugugaga-pane`, `gugugaga-files/changes.js`).
- **Four `lib.js` copies**: `gugugaga-agents/lib.js`, `gugugaga-tabs/lib.js`, `gugugaga-toast/lib.js`, and `gugugaga-pane/lib.js` do not cross-import across mod folders; update `APPS` / paths across all relevant copies when adding a CLI or avatar pool.
- **Unified narrow-rail threshold**: `gugugaga-agents`, `gugugaga-spaces`, and `gugugaga-chrome` must all switch to rail mode at `< 160` logical px.
- **Custom popup overlays**: Always pass `frame: "none"` to `openOverlay` when drawing a `rounded(0)` menu (`mods/gugugaga-files/actions.js`), or Herdr wraps it in a default rounded shadow frame.
- **Avoid font tofu in `Cascadia Mono`**: Never rely on rare Unicode glyphs like `◧` or `⋮⋮`; draw geometric pixel icons with `div()`s.
- **Pixel art integer scaling**: `sprites/` (`144×192` → `48×64`, 3:1) and `art/models/` (`224×180` → `112×90`, 2:1) must not be squished during narrowing.
- **Local untracked files**: Never overwrite or commit `jobs.json`, `places.json`, `data/`, `gpui-kit.d.ts`, `jsconfig.json`, or `tmp/`.

---

## 5. Sync & Verification Commands (Windows PowerShell)

```powershell
# 1. Sync repo -> Herdr runtime (without clobbering user's jobs.json / places.json / data/)
$dest = "$env:USERPROFILE\.config\herdr-app"
Copy-Item -Recurse -Force .\layouts\* "$dest\layouts\"
Copy-Item -Recurse -Force .\themes\* "$dest\themes\"
Get-ChildItem .\mods -Directory | ForEach-Object {
  $target = Join-Path "$dest\mods" $_.Name
  New-Item -ItemType Directory -Force $target | Out-Null
  Get-ChildItem $_.FullName -Exclude "jobs.json","places.json","gpui-kit.d.ts","jsconfig.json" |
    Copy-Item -Destination $target -Recurse -Force
}

# 2. Check all 8 mods + runtime status
foreach ($m in @("gugugaga-agents","gugugaga-spaces","gugugaga-tabs","gugugaga-toast","gugugaga-chrome","gugugaga-pane","gugugaga-files","inbox")) {
  herdr-app check "$dest\mods\$m"
}
herdr-app status   # Confirm "layout": "gugugaga" and "errors": []

# 3. Visual screenshot & pure lib sanity check
herdr-app shot ..\tmp\verify-shot.png
node -e "import('./mods/gugugaga-agents/lib.js').then(m => console.log(m.modelFamily('claude-opus-4-6').key))"
node -e "import('./mods/gugugaga-pane/lib.js').then(m => console.log(m.resolvePaneApp({app:'antigravity'}).short))"
```

---

## 6. Privacy & Attribution Redlines

- **Screenshots & Gallery assets** (`preview.png`, `layouts/*.png`): Redact or omit private remote machine names, local `C:\Users\<username>` paths, personal emails, and debug transcripts before committing.
- **Attribution**: Preserve Herdr 0.1.16 (`Apache-2.0`) notices in `mods/gugugaga-files/*` and `herdr-traveler` (`@franky5440-afk`) credits in `README.md` / `README.en.md`. Do not add a blanket third-party `LICENSE` file.
