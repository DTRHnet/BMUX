# Changelog

All notable changes to BMUX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-09

`filter` became a visual tool: every match is boxed in the pane and named as you
pass over it.

### Added

- **Filter highlighting.** `filter <selector>` now draws a box around every match
  inside the pane — a 2px outline, a light wash and 7px corner ticks, so even a
  tiny or zero-height element is findable — with a numbered tab on each box.
- **Live element naming.** Moving the pointer over a match writes
  `FILTER: <selector> - <element> · <n>/<total>` into that pane's footer status
  line (the element's `TAG#id.class` plus a title, aria-label or text snippet),
  turns that box green, and falls back to
  `FILTER: <selector> · <n> match(es)` when the pointer leaves a match.
- **Live refresh.** A `MutationObserver` (debounced 300ms) re-queries the selector
  and redraws the boxes when the page changes underneath them, so matches added
  or removed after the filter was applied show up.
- **`filter -l <selector>`** lists matches without drawing anything.
- **`filter -n <max>`** caps how many boxes are drawn (default 200, hard ceiling
  1000) while still reporting every match.
- **`filter -c`** / `--clear` removes the boxes and the status line.
- **`Esc` clears the highlights** — from the top frame, from the debug console or
  a pane input, and from inside the pane itself (a pane document is a different
  frame, so the filter installs its own Escape listener for as long as the boxes
  are on screen). Highlights are cleared before Escape does anything else, so
  Control Mode and `display-panes` still get their own Escape afterwards.
- **`escape` command**, so a key pressed in a pane frame — which cannot see the
  top frame's filter state — resolves to the same behaviour: clear highlights if
  any, otherwise leave Control Mode.
- **Per-pane status segment** in the footer: yellow while filtered, green while
  naming a hovered match.

### Changed

- The boxes live in the pane's own document, positioned in document coordinates,
  so they scroll with the page and vanish with it. Nothing is drawn into the
  page's layout: no wrapper elements around page content, no attribute changes on
  page elements, no reflow.
- `filter` with no selector is now a usage error.
- Filter state is dropped when the pane navigates (`iframe` load), when the pane
  is killed, and when the overlay resets; the pane's Escape listener is removed
  with it.

### Notes

- **Same-origin only.** A cross-origin pane cannot be measured or written into, so
  `filter` reports why and draws nothing. Navigation, sizing and reordering still
  work there.
- Boxes reflect the DOM at the moment they are drawn. A page that moves elements
  without mutating the DOM (CSS transitions, scroll-driven layout) will not
  trigger the observer — re-run `filter` (or resize the window) to re-measure.
- Two panes can be filtered independently; `Esc` clears all highlights, `filter
  -c` clears the pane it was run for.

### Verification

- `node --check` clean; all files kept CRLF line endings.
- jsdom: **481 checks** pass, including boxes drawn per match, hover naming and
  index, hover class movement, `mouseleave` fallback, Escape from the top frame
  and from inside the pane document, `filter -c`, `-l`, `-n`, invalid selectors,
  the cross-origin refusal, and filter state dropped on kill.
- Chromium 150 with the extension loaded unpacked: **49 checks** pass, including a
  real `filter .box` on a live page (2 boxes injected into the pane document),
  real mouse hover producing `FILTER: .box - DIV.box "one" · 1/2` and then
  `· 2/2` for the second element, Escape clearing the boxes from the console
  focus and from inside the pane, and `filter -c`.
- Not verified: cross-origin panes (every browser check is same-origin), the
  MutationObserver refresh path in a real browser (jsdom only), and touch input.

## [0.1.0] - 2026-11-09

A ratio-driven layout engine, real pane management, and one command registry that
every entry point shares.

### Added

- **Ratio-driven layout engine**
  - The layout is a binary split tree — `leaf` or `split(direction, ratio)` — and
    `split-window`, `kill-pane`, `resize-pane`, zoom, layout presets, `swap-pane`
    and `rotate-window` all edit that tree and recompute rectangles.
  - Panes are absolutely positioned inside `#bmux-panes` from fractional
    rectangles, so resizing the browser window keeps every pane proportional.
  - **Pane elements are never moved in the DOM.** Splitting, changing layout,
    swapping and rotating therefore no longer reload the pages in the panes.
    (Until 0.0.1, splitting reparented the iframe, and reparenting an iframe
    reloads it.)
- **Mouse resizing**: one draggable handle per split boundary — 8 px hit area, a
  hairline marker, a hover highlight and a `col-resize`/`row-resize` cursor.
  Double-clicking a handle resets that split to 50/50. While dragging, a
  full-overlay shield keeps the pointer off the pane iframes, which would
  otherwise swallow the events that drive the drag.
- **`split-window` sizes and placement**: `-l <size>` / `-p <size>` (`30%`, `30`
  or `0.3`), `-b` (put the new pane first), `-d` (keep focus on the pane being
  split). Splits are clamped to 10–90%.
- **`kill-pane`** is real: it closes a pane, gives the space back to its
  neighbour, moves focus sensibly, and refuses to kill the last pane.
- **`resize-pane`**: `-L/-R/-U/-D <percent>` moves the adjacent boundary,
  `-x <size>` sets the pane's share of its parent, `-Z` toggles zoom.
- **Zoom**: a pane can fill the overlay while the other panes keep running (they
  are hidden, not destroyed). Marked `[ZOOM]` in `list-panes` and `· ZOOM` in the
  status bar; any directional focus move unzooms first.
- **Layout presets**: `select-layout even-horizontal|even-vertical|main-vertical|
  main-horizontal|tiled`, and `next-layout` (`Space` in Control Mode) to cycle.
- **Pane titles**: `rename-pane <title>` (or `-` to clear). The footer shows the
  title, derived from the page `<title>` when same-origin or from the URL
  otherwise.
- **`swap-pane`** and **`rotate-window`**: reorder panes without reloading any
  page.
- **`display-panes`**: shows each pane number over the pane; press a digit to
  focus that pane, `Escape` cancels (`q` in Control Mode).
- **`capture-pane [-n <lines>]`**: prints the pane's visible text (same-origin).
- **`list-panes`** now shows size and title and accepts `-j|--json` for tooling.
- **`cycle-pane [next|prev]`** and **`last-pane`** (`o` and `;`).
- **Directional pane focus** (from the unreleased work on this branch, first
  shipped in 0.1.0):
  - `Up` / `Down` / `Left` / `Right` toolbar buttons, each running
    `focus-pane <direction>` through the shared dispatcher.
  - Arrow keys move focus in Control Mode and after the `Ctrl+b` prefix,
    with wrap-around at the edge of the layout.
  - Picking is geometric: the nearest pane whose centre lies in that direction,
    with a penalty for drifting off-axis; with nothing in that direction, focus
    wraps to the pane furthest on the opposite side.
  - Click to focus on a pane's body or footer, and inside its iframe (via the
    window blur/`activeElement` sync, which also works cross-origin).
- **Pane identity**: ids `%N` assigned once and never reused, reading-order
  numbers, a `[number id]` footer badge, and the focused pane in the status bar.
- **Overlay commands from the console**: `list-panes`, `focus-pane`,
  `split-window`, `kill-pane`, `resize-pane`, `select-layout`, `swap-pane`,
  `rotate-window`, `new-window`, `detach`, `control-mode` and `command-prompt` can
  be typed in the debug console, the `:` line or a pane's input.
- **`BMUX_KEYBINDINGS`**: both key tables are command lines in
  `content/commands.js`; `Alt+arrow` resizes, `z` zooms, `q` shows numbers, `o`
  and `;` cycle and return, `Space` cycles layouts.
- Toolbar gains `Zoom` and `Layout` buttons.

### Changed

- `content/commands.js` is the single source of truth for commands: every command
  (overlay and pane) defines `scope`, `description`, `usage` and
  `execute(api, args)`. `content/main.js` holds no command definitions, no help
  text and no key-to-action switch — it parses a line, looks the name up
  (own-property lookup) and calls `execute`.
- Toolbar buttons, the debug console, the `:` line, pane inputs, both key tables
  and the background relay all run the same dispatcher.
- Panes are numbered by **layout order** (top-to-bottom, left-to-right), so
  numbers follow the picture instead of the order panes were created in.
- The background relay carries a command line (`relay-line` → `execute-line` with
  `{ line }`) instead of `action`/`params`; the background knows no command names.
- `setControlMode(on)` replaces the toggle-only implementation; `control-mode
  on|off|toggle` and `Escape` share that one path.
- `split-window` still clones the active pane's URL into the new pane, but the
  original pane is no longer reparented.
- Attaching the overlay no longer leaves focus inside a hidden command input.
- The debug console no longer gets a duplicate "Split …" line for each split.
- `help` is generated from the registry and grouped by scope.

### Fixed

- **Prototype names can no longer resolve as commands or keys** —
  `constructor`, `__proto__` and `hasOwnProperty` report `Unknown command`.
- **Bad arguments never throw**: unknown pane/number/id, unknown flags, missing
  arguments and invalid sizes return a message and leave the layout and focus
  untouched; a throw inside a command is caught and reported.
- Space could not trigger a binding (`event.key` is `' '`, not `'Space'`).
- Mouse resizing stopped as soon as the pointer crossed a pane iframe.
- `resize-pane` used to refuse a direction with no neighbour on that side; every
  direction now moves the adjacent boundary.
- `rotate-window` rotated the wrong way (panes moved to the previous slot).
- Control Mode key handling no longer dereferences an overlay UI that pane frames
  do not have.
- The `:` line's open state is tracked explicitly, so keys are no longer
  swallowed when the command input has focus before the line was ever opened.
- Pane output no longer shows an empty box for commands that return nothing.

### Notes

- Still not implemented: floating panes, break/join pane, multiple windows or
  layout tabs, sessions/persistence, and broadcasting input to all panes.
- `kill-pane` never kills the last pane; use `new-window` to reset instead.
- `new-window` still resets the overlay to a single pane.
- `Escape` closes the `:` line and leaves Control Mode on; a second `Escape`
  leaves Control Mode.
- Mouse resizing needs a mouse: touch input is not handled.
- Cross-origin panes cannot be inspected (`source`, `filter`, `capture-pane`);
  navigation, reload, sizing and reordering work regardless of origin.
- `docs/DESIGN.md`, `docs/UPDATE_STATUS.md` and the 0.0.1 section of
  `RELEASE_NOTES.md` are kept as historical documents and were not rewritten.

### Verification

- `node --check` on every changed script; all edited files kept CRLF line endings.
- **jsdom harness** (`content/commands.js` + `content/main.js` loaded as the
  manifest loads them, same script order, one global scope): **439 checks**,
  covering the dispatcher, both key tables, the `:` line, pane inputs, the debug
  console, click-to-focus, wrap-around, split sizes/`-b`/`-d`, kill, resize,
  zoom, all five layouts, swap/rotate, mouse drag and clamp, display-panes,
  titles, capture-pane, list-panes text and JSON, bad input, ids/numbers/badges,
  and the background relay.
- **No-reload proof in the harness**: after three layout presets, a swap, a
  rotation, a resize and another split, every pane element is still the same
  connected node, still a direct child of `#bmux-panes`, and still owns the very
  same `<iframe>` element.
- **Real browser** (unpacked extension in Chromium 150, headless,
  puppeteer-core): **36 checks**, including mouse-dragging a split handle
  (592 → 392 px), `z` zoom and unzoom, `Space` layout cycling, `main-vertical`,
  `swap-pane`, `Alt+Arrow` resizing, `rename-pane`, `capture-pane`, killing panes
  down to the last one, arrow focus, no uncaught page errors, and a live marker
  set on the pane iframe's window that survives splitting, zooming, layout
  changes and swapping — the direct evidence that no page was reloaded.
- **Not covered by any run**: the `Alt+Shift+B` global hotkey (a browser-level
  command that cannot be synthesised from DevTools; the browser harness un-hides
  the overlay directly), the popup buttons, the `Ctrl+b` prefix in a real
  browser, `chrome.storage` state, and cross-origin panes (every browser check ran
  same-origin). Google Chrome 157 rejects `--load-extension`, so the browser run
  used `chromium`.
- Both harnesses are local only (`.verify/`, gitignored; they need `jsdom` and
  `puppeteer-core`) and are not part of the extension.

## [0.0.1] - 2025-12-09

### Initial Release

#### Added
- **Core multiplexing functionality**
  - Horizontal and vertical pane splitting
  - Unlimited nested splits
  - Current page URL cloning on split

- **Dual control systems**
  - Control Mode (Alt+Shift+B) with direct key commands
  - Legacy TMUX-style (Ctrl+b) prefix mode

- **Per-pane command system**
  - Green `>` prompt at bottom of each pane
  - Extensible command registry in `content/commands.js`
  - Built-in commands: help, source, restore, filter, url, reload, clear

- **Global debug console**
  - Draggable floating console
  - Executes commands on active pane
  - Full scrollback history

- **Console view mode**
  - `source` command transforms pane to terminal view
  - Displays HTML source with syntax escaping
  - `restore` command returns to browser view

- **CSP header removal**
  - Uses declarativeNetRequest API
  - Allows loading GitHub, Google, Facebook, etc. in iframes
  - Only affects BMUX panes (not main page)

- **Cross-origin safety**
  - Helper functions for safe iframe access
  - Graceful error messages for restricted content
  - Fallback strategies for URL detection

- **Modern UI**
  - Glassmorphism design with backdrop blur
  - Dark theme optimized for readability
  - Visual indicators (blue border for active pane)
  - Responsive layouts

- **Documentation**
  - Comprehensive README.md
  - 7 detailed guides in docs/ folder
  - Command development tutorial
  - Security and privacy documentation

#### Technical Details
- Manifest V3 browser extension
- Content scripts with iframe support
- Background service worker for state management
- Declarative net request rules
- Modular command architecture

#### Browser Compatibility
- Chrome/Edge: Full support
- Firefox: Manifest needs minor adjustments (not yet tested)

### Known Limitations
- State persistence not fully implemented (panes don't survive page reload)
- No pane resizing with mouse
- No arrow key navigation
- No session management
- Some sites with JavaScript iframe busters may not work

### Security Notes
- Requires `<all_urls>` permission for CSP removal
- All code is open source and auditable
- No data collection or external requests
- Local storage only

---

## Planned for 0.3.0

- Floating panes (a pane that overlays the layout instead of taking space)
- `break-pane` / `join-pane`
- Multiple windows / layout tabs with their own layouts
- Session persistence (save and restore layouts, titles and URLs)
- Broadcasting input to all panes
- Pane drag-and-drop reordering with the mouse
- Touch/pointer-based resizing
- State persistence in `chrome.storage`
- Better error handling and recovery

### Future Considerations
- Plugin/extension system
- Custom themes
- Cloud sync (optional)
- Firefox full compatibility
- Performance optimizations
