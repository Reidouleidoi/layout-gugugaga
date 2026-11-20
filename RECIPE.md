# Gugugaga

A Herdr window rebuilt as an arctic pixel base: the sidebar becomes an igloo-lit outline tree of machines and spaces, agents are "party members" with animated full-body sprites and a status plate, tabs carry the same face and status pill, and the whole thing sits on a deep ice-blue theme. Windows-first, macOS-aware.

![Gugugaga](preview.png)

## What you see

One row holding a 320px sidebar and the work column beside it. Inside the work column, top to bottom: the 58px tab bar, the terminal card, and a 28px status bar. Everything is drawn inside 1px dividers on the canvas color `#0b1018`, with terminal padding of 14 horizontal and 12 vertical.

**Sidebar (320px wide, min 44, max 480, not user-resizable by dragging its edge).** Its background is a pixel night scene, `mods/gugugaga-chrome/sidebar-gugugaga.png`, drawn `cover` behind the panels.

- **Brand strip, 46px:** a 20px pixel face (`mods/gugugaga-agents/art/gugugaga/a1.png`), the "Herdr" wordmark in 13.5px semibold, then two 26px icon buttons: search (opens the picker) and sidebar toggle.
- **Spaces (upper half of the list area, weight 1, min 90):** a pixel outliner, headed by `Spaces` in 11px accent and a 24px `+` button. Each machine is a 28px row: a 2px accent bar, the 13px `bullet-open.svg` / `bullet-folded.svg`, a 13px device icon (`device-local.svg` for this computer, `device-remote.svg` for an SSH machine), a `▾`/`▸`, the machine name in 10.5px semibold, its state when it is not connected, a `[n]` count, a `+` and a 7px square in its status color. Spaces hang under the row on a 2px trunk at x=9, joined by a 7x2px branch, with a 7x7px node for the space you are on and a 5x5px one for the rest. Each space shows a 42x42 pixel building in a 46x46 frame (picked from a pool of four: `igloo`, `lighthouse`, `fishshop`, `iceberg`), its name (11px, `max_w` 150px inside a machine group or 176px ungrouped, semibold when it is the one shown), the git branch, and changed/untracked counts. A machine with no spaces gets a single "+ New space there" row instead; a machine that has spaces does not.
- **Party, the agents list (lower half, weight 1, min 90):** a header `Party` in 11px accent plus a `[n]` chip, then one unified 109px showcase card per agent (`CARD_STEP` 117px). Each card pairs a 56px left sprite lane (a 48x64 penguin on a 2px `━━┓┗━━` step rail above a frameless `#Tab` label) with a 240×96 sharp-corner pixel nameplate (`PLATE_TOP` 11px) separating **CLI skin × Model portrait × Runtime status**: riding CLI & status/squad badges across the top edge, a 160px model banner with 12×12 vendor logo, a 5-cell 3×4 pixel Effort meter + optional custom session/tab subtitle underneath, a right-aligned 112×90 model portrait (with deep-night `IDLE` dimming, widened left scrim, 5px top clearance, and `gugugaga.png` as the unknown-model fallback), and a flush 142×19 bottom-edge Space notch next to a bottom-track status bar.
- **Footer, 69px:** two rows on the chrome color with a 1px top border — Settings (with a small dot when an update is ready) and Add machine.

**Work column.**

- **Tab bar, 58px:** each tab is a 48px card with a 2px strip across its top (accent when it is the tab you are on, amber when it is blocked) holding a 40x40 character portrait (a 32x42 sprite when there is no still), a 16px agent crest (an 11px glyph in a tinted slot), the tab name at 12.5px, and a status pill (9.5px label in a 15px pill tinted with the status color). To their right, Files, Changes and Inbox buttons and a new-tab `+`, all 26px; on Windows also min/max/close.
- **Terminal card:** the pane sits in a body with 8px padding and an 8px gap, so every pane is a rounded 8px card with a 1px `#ffffff14` border; the focused pane gets a 1px accent outline and a 30px header strip holding the pane title.
- **Side panel, 368px (min 280, max 900), hidden until you press one of its buttons:** a stack of Files, Changes and Inbox.

**Status bar, 28px:** Herdr's own workspace status, restyled only by the theme.

**Colors** come from the theme `gugugaga-ice`: canvas `#0b1018`, chrome and surface `#141b27`, raised `#1c2533`, border `#ffffff14`, text `#e9eef5` with muted `#a3afbf` and dim `#6b7686`, accent `#8ccaff`, amber `#ffb547`, selection `#26344a`. Status colors: working `#8ccaff`, blocked `#ffb547`, done `#7fd8a8`, idle `#5d6878`. The terminal itself is `#0f1520` with a `#ffb547` cursor and full opacity.

## How it behaves

Four states drive everything — the sprite, the card badge, the tab pill, the squad chip and the toast all read the same status:

| state | sprite | tab mark | color |
| --- | --- | --- | --- |
| working | `sprites/gugugaga/w/*.gif`, 4 frames at 160ms each | `▘▝▗▖` cycling every 140ms | accent `#8ccaff` |
| blocked | `b/*.gif`, 4 frames at 320ms each | `!` blinking (600ms in the cards, 450ms in the tabs and toast) | amber `#ffb547` |
| done | `r/*.gif` (the rest cycle) | `✓` | green `#7fd8a8` |
| idle | `r/*.gif`, 4 frames at 1800/140/900/700ms, so one loop takes 3.5s | `▪` | dim `#5d6878` |

- **Clicks & drag-reorder.** Left-click on a card focuses the agent (`agent.focus`); dragging a card onto another reorders the Party list and persists `agents.order` in `localStorage`. A squad row focuses that terminal's pane (`pane.focus`) or, for a helper without a pane of its own, peeks at it (`terminal.peek`). The squad chip (`▾`/`▸` + count) folds and unfolds its children and takes the color of the most urgent child. A tab selects, drags to reorder (`tab.move`), double-clicks to rename, right-clicks into a popup menu, and shows a close `x` only on the active tab. The Files/Changes/Inbox buttons show, swap and hide the side panel.
- **Spaces.** Click selects, drag reorders (`space.move`), right-click opens the space menu; the machine row collapses its spaces; `+ New space there` makes a space on that machine and `+ Add machine` opens the add-machine flow.
- **Sidebar toggle.** The rail goes by width, not a flag: below 160px the sidebar is "collapsed", so it shrinks to 44px (76 on macOS, room for the traffic lights) and remembers the width it had in shared state (defaulting to 320px on restore).
- **Sub-agents.** Children come from `terminals().parent`, not from the agents list. Each is one 17px row with a 2px trunk aligned at x=27 under the `#Tab` label, a 9x2 branch and a 5px node in its status color, indented 12px per depth up to 3 depths (`DEPTH_MAX = 3`); a child that reports `error` reads as blocked and a child never claims done.
- **Unified showcase lane.** All Party cards share the same 109px showcase layout with the sprite fixed on the left and the 240×96 nameplate on the right—there is no two-lane stagger, and subagent rows attach directly beneath each parent card.
- **Toast.** A status change slides a pixel nameplate: a 2px colored top bar, four 2px corner studs, a 40px framed avatar (portrait, sprite, or the program icon), the title and body, and a status badge. It is clickable when it carries an action, and a machine that needs a login reads "`<machine>` needs a login: run" so the command can be copied.
- **The inbox panel** lists what is in `data/inbox/files` with a kind badge, size and time; a click opens the file with the system default app, right-click copies it to the Desktop without overwriting, or moves it to the trash where it can still be recovered.

## Built from

`layouts/gugugaga.json` (200 lines) is Herdr's `main` layout with the sidebar rebuilt:

```
root  row  (background canvas, terminal_padding [14,12], divider 1px border,
            titlebar none, traffic_lights [12,16],
            toast "gugugaga-toast", theme "gugugaga-ice", terminal_opacity 1)
├─ sidebar  column  320px, min 44, max 480, resizable false
│  │  background image mods/gugugaga-chrome/sidebar-gugugaga.png, fit cover
│  ├─ brand          block {mod: gugugaga-chrome}        46px, window_drag
│  ├─ sidebar-lists  column
│  │  ├─ spaces      block {mod: gugugaga-spaces}  weight 1, min 90
│  │  └─ agents      block {mod: gugugaga-agents}  weight 1, min 90
│  └─ sidebar-footer block {mod: gugugaga-chrome, props {footer: true}}  69px
├─ work  column
│  ├─ tabs           block {mod: gugugaga-tabs}   58px, window_drag
│  ├─ work-body      row  padding 8, gap 8
│  │  ├─ main        block {tab: active, pane {header {content {mod: pane},
│  │  │                     reveal always, height 30, position top},
│  │  │                     border 1 #ffffff14, focus 1 accent, radius 8, gap 8,
│  │  │                     lone true}}
│  │  └─ panel       column 368px, min 280, max 900, hidden
│  │     └─ panel-body stack active files
│  │        ├─ files    block {mod: files}
│  │        ├─ changes  block {mod: changes}
│  │        └─ inbox    block {mod: inbox}
└─ status            block {mod: workspace-status}  28px  (the work column's third child,
                                                             not the root's)
```

Keep `toast`, `theme` and `preview` in the root: the toast mod is attached there rather than in a block, and `preview` is the window thumbnail Herdr shows in its layout picker.

Six mods, no `mods/<name>/mod.json` logic beyond `place: none` and `cloned_from` — they all render into blocks or overlays:

- **`gugugaga-chrome`** — one class with two roles chosen by `props().footer`: the brand strip (wordmark, search, collapse) or the footer rows (Settings → `app.settings`, Add machine → `mod.open machine-add`). Owns the sidebar background image and 30 SVG icons.
- **`gugugaga-spaces`** — the outline tree. Art: `art/gugugaga/{igloo,lighthouse,fishshop,iceberg}.png`, `device-local/remote.svg`, `bullet-open/folded.svg`. Picks a building by name hash unless `mods/gugugaga-spaces/places.json` (a local, untracked file) maps a space to one. Runs `hc machine ls --json` for the machine rows and `git status --porcelain=v2 --branch` plus `git rev-parse --show-toplevel` and `--git-common-dir` (with `--no-optional-locks`, `core.fsmonitor=false`, `safe.bareRepository=explicit`) for branch and dirty counts.
- **`gugugaga-agents`** — the Party list. Art: 7 portraits `art/gugugaga/a1..a7.png` at 256x256, 21 GIFs `sprites/gugugaga/{r,w,b}` at 144x192 (drawn 48×64), 8 model portraits `art/models/*.png` (drawn 112×90), 9 `12×12` vendor SVG logos `art/vendors/*.svg`, and CLI pixel badges `art/logo-*.svg` across 9 CLIs (`CLI_SKINS` covers 10 sharp-corner pixel frame styles). `lib.js` holds the art pools, `CLI_SKINS`, `MODEL_FAMILIES`, and job/session helpers: optional `mods/gugugaga-agents/jobs.json` maps a tab name to a persona, and `data/traveler/sessions/<address>.json` is read (never written) for model/effort/session name, locally and on `~/.config/herdr-app` of a remote machine. With no cache file it falls back to `hc read <address> --lines 25` and parses the tail of the screen for the model & effort.
- **`gugugaga-tabs`** — the tab bar: portrait, 9-CLI crest, name, status pill, panel buttons, new-tab `+`, Windows window buttons (`win-min/max/restore/close.svg`), drag and rename. Its own `lib.js` copy scans the sprite folders on init and re-watches them, and polls them every 30s so hand-added art shows up without a restart.
- **`gugugaga-toast`** — the nameplate overlay described above; reads its own `lib.js` copy (including all 9 CLI crests) and the job cache, and resolves the title from the overlay props, the agent, the space or the tab. Unlike the other two it does not scan the art folders, so it always uses the first asset of each pool.
- **`inbox`** — the file panel over `data/inbox/files`. On macOS it shells out to `/bin/mkdir -p`, `/usr/bin/find`, `/usr/bin/stat -f %HT`, `/usr/bin/open`, `/bin/cp -n` and `/usr/bin/trash`; on Windows to PowerShell (`Get-ChildItem`, `Invoke-Item`, `Test-Path` + `Copy-Item`, and `Microsoft.VisualBasic.FileIO.FileSystem::DeleteFile` with `SendToRecycleBin`). It never runs `rm`, it overwrites nothing, and a trashed file can be recovered.

`gugugaga-agents`, `gugugaga-tabs` and `gugugaga-toast` each carry their own copy of `lib.js`: they agree on the art paths by convention, not at runtime.

Herdr functions in use: `agents, spaces, terminals, panes, theme, props, layout, run, shared, setShared, settings, updates, window, appHome, home, readTextFile, watchFolder, exec, hc, openOverlay, closeOverlay`, plus `localStorage` for the panel choice and `cx.timer` / `cx.spawn` for polling.

## Watch out

- **The sidebar is collapsed by width, not by a flag** (`< 160px`). Rebuild it with a boolean and the rail will fight the drag. The mod also writes the old `sidebar.collapsed` shared key because mods from before the change still read it.
- **macOS needs its own numbers**: the brand strip gets a 76px left padding for the traffic lights, the tab bar reserves room for the window buttons, and the collapsed width is 76 instead of 44. Ignoring this puts the collapse button under the traffic lights.
- **Unified 109px cards rely on the 320px sidebar.** The 56px left sprite lane + 8px gap + 240px nameplate require the 320px sidebar width (`PLATE_W = 240`, `ART_W = 112`). Narrowing the sidebar back to 268px clips the nameplate.
- **Sub-agent rows are not in `agents()`**. Their parent relation only exists on `terminals()`, the indentation depth caps at 3 (`DEPTH_MAX = 3`), and a child that reports `error` has to be read as blocked or it will look idle while it is stuck.
- **Real programs run**: `hc machine ls --json`, `hc read <address> --lines 25` and three `git` calls (spaces and agents), `mkdir`/`find`/`stat`/`open`/`cp -n`/`trash` or their PowerShell twins (inbox). Nothing reaches the network. The agents mod reads `data/traveler/sessions/*.json`; the inbox reads `data/inbox/files` and writes only to `~/Desktop` and the trash. All of that is outside the mods' own folders.
- **`jobs.json` and `places.json` are local mappings**, deliberately untracked here: without them every tab and space still gets art, by hash. Do not ship your own mapping as part of the layout.
- **Type is tiny on purpose**: 13.5px chrome, 11px Party header, 9–9.5px badges. Raising the badge sizes breaks the 58px tab bar and the 64px cards.
- **Pixel art is integer-scaled by hand**: sprites are drawn 48x64 from 144x192 sources (a clean 3:1 downscale), portraits 48x48 from 256x256, buildings 42x42 from 160x160 — the last one is *not* an integer ratio, which is why the frame is 46x46 and the building is centred in it. Any other zoom softens the art; there is nothing to turn off.
- **The macOS rail cannot be unfolded.** When the sidebar is narrower than 160px the chrome mod hides its collapse button on macOS (the traffic lights fill that row) and nothing else offers the way back, while the sidebar is not resizable. Until a `»` button is added to the agents rail, macOS users should not collapse it. This was not exercised on macOS, so treat the whole rail as unverified there.
- **Windows first**: the window buttons, the PowerShell branches in the inbox, and the OneDrive desktop path handling are written for Windows; macOS gets the traffic lights, and the Linux path was not exercised.
- **The side panel starts hidden**, so a fresh install shows no Files/Changes/Inbox until one of the tab-bar buttons is pressed. That is the layout, not a broken mod.
