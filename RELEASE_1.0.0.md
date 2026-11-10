# BMUX 1.0.0 — release

**The first stable release.** A browser tab becomes a terminal-style multiplexer:
panes that never reload, layouts that survive, windows you can switch between, a
command line that can look inside the pages, and a toolbar you can edit.

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Released** | November 2026 |
| **Browser** | Chrome / Chromium, Manifest V3 (Firefox untested) |
| **Commands** | 70, all documented, all scriptable |
| **Coverage** | 1194 jsdom checks · 188 Chromium checks |
| **License** | MIT |
| **Download** | `git clone https://github.com/dtrhnet/BMUX`, then load unpacked |

---

## Install and first run

1. `git clone https://github.com/dtrhnet/BMUX` (or download the repository as a ZIP).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and
   select the `BMUX` folder.
3. Refresh any tab you want to use it in.
4. Press **`Alt+Shift+B`** — or click the toolbar icon and choose **Toggle**.

You are in Control Mode: `%` splits side by side, `"` splits below, `c` makes a new
window, `:` opens the command line, and `help` explains the rest.

---

## What 1.0.0 contains

### The multiplexer
- **Ratio-driven split tree** — `split-window -h|-v -l 30%`, drag any boundary,
  double-click a handle for 50/50. Panes are never reparented, so splitting, swapping,
  rotating or re-laying-out never reloads a page.
- **Layout presets and reordering** — `even-horizontal`, `main-vertical`, `tiled`, …
  `select-layout`, `next-layout`, `swap-pane`, `rotate-window`, `resize-pane -Z` (zoom).
- **Focus that never dead-ends** — arrows move geometrically and wrap, `display-panes`
  puts a number over every pane, `cycle-pane`/`last-pane` walk the layout.
- **Windows** — up to six named layouts per tab, switched with `n` / `p`, the status-bar
  chip or `select-window`, each keeping its own panes, focus, zoom and consoles.
- **Per-pane consoles** — scrollback, resize grip, detach into a floating window.

### Persistence
- **Every layout survives a reload** (`chrome.storage.session`, per tab), and a layout
  **follows the page** when you navigate; a brand-new tab **inherits** the newest layout.
- **Named layouts** per site in `chrome.storage.local`, `save-layout` / `restore-layout`.
- Snapshots are validated whole (version, shape, ratios, caps); a bad one is refused,
  never half-applied. Version-1 snapshots are upgraded automatically.

### The command line
- **70 commands** through one dispatcher: toolbar, console, `:`, pane inputs, keys and
  scripts all resolve to the same registry.
- **`help` that helps** — categorised tables, `help <command>` for usage, arguments,
  flags, examples and notes, `help overlay`, `help pane`, `help <category>`.
- **`.bmux` script files** — commands, one per line, paced with `sleep`, run from a
  panel, a file on disk (`script file --run`) or the built-in demo (`script demo`).

### Inspection
- **Cookies** for the pane's origin, `httpOnly` included, with a Netscape export that
  `curl`, `wget` and `yt-dlp` accept; `set-cookie`, `delete-cookie`, `clear-cookies`.
- **Storage** — `list-storage` / `set-storage`, read inside the pane's own frame, so
  cross-origin panes work.
- **Page inventory** — `list-forms`, `list-scripts --third-party`, `list-resources`,
  `outline` (headings, landmarks, level jumps), `find-text` (boxes drawn in the page).
- **`eval`** — JavaScript in the page's own world, printed as a table or JSON.

### Look and feel
- **Seven palettes** (`frost` default, `classic`, `midnight`, `amber`, `light`, `nord`,
  `rose`), switched with `theme` and saved with the layout.
- **Box-drawn tables** for every listing, with right-aligned numbers and ellipsis.
- **An extension menu** — **Toggle** and **Settings** — and a **toolbar you can edit**:
  add any command as a button, verified against the registry before it is saved.
- **The version, on screen** (`BMUX v1.0.0`) in the top menu and in the menu popup.

---

## Notes for upgraders

- **`new-window` changed meaning in 0.7.0**: it creates a window. The old reset is
  `reset-layout`. A `.bmux` script from before 0.7.0 needs that one word changed.
- **The toolbar buttons lost their ids** in 0.9.0 (`#btn-split-h` → `data-command`);
  only something that clicked them by id would notice.
- **The `cookies` permission** was added in 0.8.0 for `httpOnly` visibility. It is used
  only when you run a cookie command, for the pane you name.
- Stored layouts from any 0.x release load fine: the snapshot format is version 2 and
  version 1 is upgraded on read.

## Known limitations

Restored panes load fresh (a page cannot be cloned live). `source`, `filter` and
`capture-pane` need a same-origin pane; the inspection commands and `eval` do not.
`eval` is subject to the page's CSP. A hidden window keeps its iframes running, which
is why the cap is six. `Alt+Shift+B` can be taken by a window manager — rebind it at
`chrome://extensions/shortcuts`. Firefox is untested.

The full, honest list is in the README under
[Known limitations](README.md#known-limitations).

---

## Verification

- `node --check` clean on all seven scripts; `manifest.json` parses as 1.0.0.
- **1194 jsdom checks** — the real `background/main.js` runs as a second window against
  in-memory storage: persistence round-trips, snapshot upgrades, windows, scripts, the
  inspection protocol, the cookie broker, the toolbar configuration, `help`.
- **188 Chromium checks** — the unpacked extension in a real browser: split/swap/rotate
  with no reloads, drag handles, filters, prompts, the menu, the settings page, cookies
  through the browser's own API, inspection on a genuinely cross-origin pane.
- **70/70 commands** documented in the README, the command guide and the help metadata.

## Get involved

Bug reports, ideas and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
The most useful thing you can send is a page where a pane misbehaves, with the browser
and BMUX versions.

**Thanks to the tmux project and its maintainers**, whose model this borrows from
deliberately; to the terminal-tooling community (`fzf`, `reptyr`, the TUI libraries)
whose workflows started this; and to everyone who reported a bug or asked for a command.

— KBS <admin@dtrh.net>
