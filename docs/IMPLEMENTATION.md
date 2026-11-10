# BMUX Implementation Summary

**Version 1.0.0** — this describes the shipped code, not a plan. Where a section
records history (the popup that used to exist, the layouts that used to be thrown
away on reload), it says so.

## Current Status (0.8.0)

BMUX is fully functional. 70 commands across two scopes, a ratio-driven split tree
that never reloads a page, visual filters, clickable prompts, per-pane consoles that
can be detached, per-tab persistence with named layouts plus several named windows per tab, `.bmux`
script files, and pane inspection (cookies, storage, DOM inventory and page-world
`eval`).

### 1. **Activation**
Two ways in, and no session object. `Alt+Shift+B` (or `detach`, `d`) shows the
overlay *and* enters Control Mode, and doing it again hides the overlay and leaves
Control Mode. The toolbar icon opens the **menu** (0.9.0): `popup/popup.html` with
**Toggle** (which sends `toggle-bmux` to the active tab) and **Settings** (which opens
the options page). With `default_popup` declared, `chrome.action.onClicked` no longer
fires — the menu is the icon's action, the hotkey stays the direct path.
`detach` (`d`) toggles the same state from the keyboard. The 0.5.0 removal of the
popup and of the dead `STATE` / `createSession` machinery still stands for what the
popup *was*: a session manager. The menu that came back in 0.9.0 holds two verbs —
toggle and settings — and no state of its own.

### 2. **Global Hotkey (Alt+Shift+B)**
- Registered in `manifest.json` as a browser-level shortcut
- Cannot be blocked by websites
- Toggles BMUX: overlay plus Control Mode on, the same keys off again
- Works across all tabs and iframes (a pane's iframe keeps listening)

### 3. **Control Mode**
Activation is one state: clicking the toolbar icon (`chrome.action.onClicked`) or
pressing `Alt+Shift+B` shows the overlay *and* enters Control Mode; doing it again
hides the overlay and leaves Control Mode. When activated:
- A quiet one-pixel inset ring around the overlay (`.bmux-control-active`) and a
  tinted `CONTROL MODE` chip in the status bar — not a thick blue frame
- The status bar's left segment reads `CONTROL MODE` (tinted) or `NORMAL`
- All keyboard input is captured by BMUX, except while a console or pane input
  has focus (typing always wins)
- Keys resolve through `BMUX_KEYBINDINGS.control` in `content/commands.js`:
  `%` split horizontal, `"` split vertical, `c` new-window, `d` detach,
  `x` kill-pane, `:` command-prompt, arrows focus-pane, `Alt+arrows` resize,
  `z` / `Shift+z` zoom, `l` log toggle (pane console), `q` display-panes, `o`
  next pane, `;` previous pane, `Space` next-layout, `Esc` the `escape` command
  (clear filter highlights, else leave Control Mode)

### 4. **Layout engine**
The layout is a binary split tree, held in `BMUXClient.layout`:

```javascript
leaf  = { kind: 'leaf', pane: HTMLElement }
split = { kind: 'split', direction: 'row' | 'column', ratio, first, second }
```

- `ratio` is the share of the split given to `first` (0..1).
- `computeLayout()` walks the tree once with `{ x: 0, y: 0, w: 1, h: 1 }` and
  produces, per leaf, a fractional rectangle; splits keep their own rect so the
  drag handles can be positioned.
- `renderLayout()` applies those rectangles to the pane elements as
  `calc(<pct>% ± gutter)` for `left`/`top`/`width`/`height`, hides panes when
  zoomed, and repositions one handle per split boundary.
- Every structural operation is a tree edit plus a render:
  - `splitWindow(direction, opts)` replaces the active leaf with a `split` and a
    new leaf;
  - `killPane(pane)` replaces the pane's parent split with the sibling;
  - `resizePane` / `setPaneSize` change a `ratio`;
  - `applyLayout` / `nextLayout` rebuild the tree from the same panes;
  - `swapPanes` / `rotatePanes` reassign leaves' `pane` references;
  - `zoomPane` records `zoomedPane`; rendering hides the rest.

**Panes are never moved in the DOM.** All panes are direct children of
`#bmux-panes` and absolutely positioned. Reparenting an iframe in the DOM reloads
it, so a layout engine that moved panes would reload every page whenever the
layout changed; keeping the DOM flat is what makes split / re-layout / swap /
rotate non-destructive.

Ratios are fractions, so a browser-window resize re-renders everything
proportionally (`window.resize` handler).

### 5. **Mouse resizing**
- `renderHandles(splits)` keeps a pool of `.bmux-split-handle` elements in
  `#bmux-handles` (a click-through layer). Each handle is 8 px wide, sits on its
  boundary (`calc(<boundary>% - 4px)`), and carries `_split`/`_rect` references.
- `startHandleDrag` converts the pixel delta into a ratio using the split's
  rendered size, clamps it to 5–95%, and re-renders on every `mousemove`.
- While dragging, `#bmux-drag-shield` covers the overlay: mouse events over a pane
  iframe go to that iframe's document and never reach the parent, so without the
  shield the drag stalls as soon as the pointer crosses a boundary.
- Double-click resets the split to 50/50.

### 6. **Zoom**
`zoomPane` sets `zoomedPane`. `renderLayout` then renders that pane at the full
rectangle and sets `display: none` on the others — they stay loaded (an iframe
that is merely hidden keeps running). Handles are hidden while zoomed, and a
directional focus move unzooms first so it reads the real geometry.

### 6b. **Windows**
A tab holds up to six **windows**, each a complete layout. The trick that keeps the
diff small: the client's live fields — `layout`, `zoomedPane`, `rootPane`,
`layoutName`, `lastActivePane` — always describe the **active** window, and every
other window keeps its own copy in a record:

```javascript
window = { id: 'w2', name: 'docs', layout, zoomedPane, rootPane, layoutName, lastActivePane }
```

Switching is therefore three steps, in `activateWindow()`: `stashActiveWindow()`
copies the live fields into the current record, `unstashWindow(record)` loads the
target's, and `applyWindowVisibility()` hides every `.bmux-pane` whose
`dataset.windowId` is not the active window's. `renderLayout()` then runs unchanged
— it only ever sees one tree, so splitting, focus, zoom, presets, `display-panes`
and the renderer needed no window awareness at all.

Panes are never moved between windows in the DOM: a hidden window's panes stay where
they are with `display: none`, which keeps their iframes running (an unloaded iframe
would reload on the way back). That is what makes a switch instant and what caps the
feature at six windows.

`killWindow()` destroys that window's panes (`destroyPane()`, which also drops its
filters, prompts and floating console) and refuses the last window, mirroring
`kill-pane`'s rule for the last pane. `newWindow()` creates one pane on the current
page and switches to it; `resetLayout()` is the old `new-window` behaviour, now
scoped to one window. Completion vocabulary for `select-window`/`kill-window` is
read from the window list, so names complete without extra wiring.

### 7. **Focus model**
- The active pane is the one with the `active` class (an ice-cyan outline and a
  brighter footer, the frost palette's equivalent of tmux's highlighted border),
  always set explicitly by `setActivePane`.
- Sources: a split, a click on the pane, a click inside its iframe (detected from
  the window blur with the iframe as `activeElement`), `focus-pane`,
  `cycle-pane`, `last-pane`, `display-panes`, and focus moving to a survivor after
  `kill-pane`.
- Directional focus reads real pane rectangles and picks the nearest centre in
  that direction with a penalty for off-axis drift; with nothing in that
  direction it wraps to the pane furthest on the opposite side.

### 8. **Pane identity and titles**
- Ids `%1`, `%2`, … are assigned once (`data-pane-id`) and never reused.
- Numbers are the pane's position in *layout order* (tree order: top-to-bottom,
  left-to-right), recomputed on every render.
- The footer shows title, command input and a `[number id]` badge; the title is
  `rename-pane`'s value, else the page `<title>` (same-origin) refreshed on the
  iframe's `load`, else the URL.

### 9. **Command registry**
- `content/commands.js` defines every command (overlay and pane) with `scope`,
  `description`, `usage`, `execute(api, args)`, plus `BMUX_KEYBINDINGS`.
- `content/main.js` contains no command definitions, no help text and no
  key-to-action switch: `runCommand(line, opts)` parses, looks up with an
  own-property check, and calls `execute` with `api = { client, pane, log }`.
- One dispatcher serves the toolbar, console, `:` line, pane inputs, both key
  tables and the background relay. `runCommand` never throws: command errors and
  bad input come back as strings.

### 10. **Filter overlay**
`filter <selector>` turns element search into something visible:

- `filterPane(pane, selector, { max })` injects one `[data-bmux-filter-layer]`
  into the pane's own document (same-origin only) and appends a
  `[data-bmux-filter]` box per match, positioned in document coordinates
  (`getBoundingClientRect() + scrollX/scrollY`), so boxes scroll with the page.
  Each box is `pointer-events: none`, carries its 1-based index, and gets its
  outline, wash and corner ticks from a `<style>` injected with the layer.
- `mousemove`/`mouseleave` listeners on that document walk from the event target
  up the tree to find a boxed element, move the `bmux-filter-hover` class, and
  write `FILTER: <selector> - <element> · <n>/<total>` into the pane footer's
  status segment (`setPaneStatus`, yellow while filtering, green while hovering).
- A debounced `MutationObserver` re-queries the selector and redraws, so pages
  that add or remove matches stay in sync.
- `Esc` clears the overlay before anything else consumes Escape: the top frame
  handles it directly, and while a highlight exists the same listener is attached
  to the pane document, because a key pressed with the focus inside a pane never
  reaches the top frame's key handler. The `escape` command gives keys relayed
  from a pane frame the same behaviour.
- `clearFilter(pane)` removes the layer, the listeners, the observer and the
  status text, and is called when the pane navigates (`iframe` load), is killed,
  or the overlay resets. Cross-origin panes cannot be measured or written into,
  so `filter` reports why and draws nothing.

### 11. **Pane console**
Each pane's footer ends in a console panel (`display: flex` when open, closed by
default):

- `appendPaneOutput(pane, text, kind)` appends one block per command line and per
  result to `.bmux-pane-output-log` (capped at 100 blocks), keeping the newest in
  view unless the user has scrolled away from the bottom.
- `setPaneConsoleOpen` / `togglePaneConsole` flip the `open` class and the footer
  toggle glyph; the open state and the height live in `data-console-open` /
  `data-console-height`, so they survive splits, layout changes, zoom and
  swapping (panes are never recreated).
- The panel's top edge is a grip: `startConsoleResize` converts the vertical drag
  into a height clamped to 40px … 90% of the pane, and double-click resets it.
- `log toggle|on|off|clear|size <px>` and the `l` key are the command-line and
  keyboard equivalents; `clear` empties the scrollback.
- There is no auto-collapse: a command opens the console and leaves it open.

### 12. **Command line editing**
`bindCommandInput(input, { onSubmit, report })` is shared by the pane consoles, the
floating console and the `:` line. It owns Enter (submit), `ArrowUp`/`ArrowDown`
(history) and `Tab` (completion), and resets the history cursor on a real `input`
event so typing starts a fresh place in it.

- History is one array on the client (`commandHistory`, 200 entries, consecutive
  duplicates collapsed), so every input recalls the same commands. Each input
  keeps its own cursor and draft in `input._bmuxHistory`.
- `completionFor(segment)` reads the vocabulary from the registry
  (`BMUX_COMMANDS`, `BMUX_LAYOUT_NAMES`, `BMUX_FILTER_PRESETS`) plus a small
  per-command argument table (`argumentCandidates`), and completes the last token of
  the segment found by `lastSegmentStart` — which understands `;`, quotes and
  `[] () {}`, so chained lines complete the right command.
- One candidate replaces the token and adds a space; several fill in the common
  prefix; if the prefix does not grow, the candidates are listed through the
  input's `report` callback (pane console or debug console).

### 13. **Filter presets and confirmation**
`BMUX_FILTER_PRESETS` in `content/commands.js` maps a word to a selector plus
optional variants, and a variant may carry a `test(element, doc, view)` predicate
for things CSS cannot express (`links internal` resolves each `href` against the
pane document's origin, falling back to its base URI for documents without an
origin of their own). `collectFilterMatches(pane, selector, test)` runs the query
and the predicate without drawing anything.

`filter` asks before drawing when the query is a preset or matches more than 25
elements: `requestFilterConfirm` stores a pending prompt, writes it into the pane
status line, attaches a `keydown` listener to the pane document so `y` / `n` /
`Esc` work with the focus inside the page, and starts a 15-second timeout.
`resolveFilterConfirm(accept)` is what the `yes` / `no` commands (and the hidden
`y` / `n` aliases) call, and `filter -y` bypasses the prompt entirely.

### 14. **Command chains**
`splitCommandLine` splits a line on top-level semicolons (`;` outside quotes and
`[] () {}`; `\;` is literal) and `runLine` executes the segments one after
another, awaiting each. Every entry point (debug console, `:` line, pane input,
key dispatch, background relay) goes through `runLine`, so chaining works
everywhere; the pane console echoes and reports each segment separately.

Because segments are awaited, a command that raises a prompt blocks the rest of
the chain until the prompt is answered — which is what makes
`filter links; list-panes` show the refined result in the second segment.

### 15. **Prompts**
`ask(pane, { question, details, choices })` returns a promise and renders a card
above that pane's footer:

- the card is a child of the overlay, positioned from the pane's rectangle and its
  footer's top edge (`positionPrompt`), re-positioned on `resize` and on every
  `renderLayout` (`refreshPromptStack`);
- choices are real buttons with a digit shortcut; `handlePromptKey` (top frame)
  plus a `keydown` listener on the pane document (so keys pressed with focus
  inside the page work) resolve digit / `Enter` / `y` / `n` / `Esc`;
- `resolvePrompt` removes the card and listeners and resolves the promise with
  `{ choice, text, cancelled }`; `cancelPrompt` does the same with a cancel;
- one prompt per pane (`prompts: Map<pane, state>`), and the prompt is cancelled
  when the pane is killed, its iframe loads a new document, `renderWindow` runs, or
  the overlay is hidden;
- `askText` is the same card with an input row; text prompts do not time out.

`api.ask` / `api.askText` expose it to commands, and `answerOpenPrompt` is what the
`yes` / `no` commands call.

### 16. **Per-pane maximize**
Every pane footer carries a `⤢` / `⤡` button. A click runs `resize-pane -Z` for
that pane through the dispatcher, so the pane button, `z` / `Shift+z`, and the
toolbar `Zoom` button all change one piece of state (`zoomedPane`);
`refreshPaneControls` syncs the glyphs from the render path.

### 17. **Layout persistence**
Two layers, both written by `background/main.js` (the content script never touches
`chrome.storage` — `storage.session` is not readable from a content script without
`setAccessLevel`, and only the background knows the tab id):

| Layer | Key | Lifetime |
|-------|-----|----------|
| `storage.session` | `layout:tab:<tabId>` | every window of that tab; survives reload / navigation; dies with the browser |
| `storage.local` | `layout:named:<origin>:<name>` | explicit saves; survives restarts |
| `storage.local` | `persist:enabled` | the auto-restore switch |
| `storage.local` | `persist:inherit` | whether a new tab adopts the newest layout |

Messages the content script uses: `persist-load`, `persist-save`, `persist-clear`,
`persist-set-enabled`, `persist-set-inherit`, `layout-save`, `layout-list`,
`layout-load`, `layout-delete`, and the 0.8.0 brokers `frame-id`, `exec-script`,
`cookie-list`, `cookie-set`, `cookie-remove`. Every reply carries the origin and tab
id; nothing is stored by the content script.

**Write path.** `renderLayout()` ends with `scheduleSave()` (400 ms debounce);
`setActivePane`, `renamePane` and the console setters save explicitly;
`visibilitychange -> hidden` and `pagehide` save immediately, because an MV3 tab can
be torn down without a later debounce firing. A save is skipped while
`this.restoring` is set, when the switch is off, and when there is no layout.

**Read path.** `init()` builds the UI but renders no panes; `loadPersistedLayout()`
asks for the tab's snapshot (800 ms ceiling if the worker is asleep) and either
`applySnapshot()`s it or calls `renderWindow()`. `applySnapshot` rebuilds the tree
from data — one pane per leaf, an `id -> element` map for the active/zoomed pane,
consoles restored, `nextPaneId` at least the highest restored id — inside a
`restoring` barrier so saves cannot recurse, with `try/finally` so the barrier is
always cleared.

**Follow the page.** Each window records which pane was its root (`rootPaneId`). When
the reloaded `window.location.href` differs from the snapshot's `url`, `applySnapshot`
repoints the **active** window's root pane at the current address (the other windows
are not this tab's page) and leaves every other pane's URL alone — the tab's layout survives navigation without resurrecting the page you left.
A plain reload matches, so nothing changes; `restoredNote` reads `followed the page`.

**Inheritance.** With `persist:inherit` on, `persist-load` returns
`inheritedFrom: <tabId>` when the asking tab has no snapshot of its own: the
background picks the newest valid snapshot from another tab (`newestOtherLayout`),
and the content script applies it through the same `rootPaneId` path, so the new
tab shows its own page in the root pane and the copied panes keep theirs. When the
switch is off, no snapshot is offered to other tabs.

**Snapshot v2 and the v1 upgrade.** Version 1 held one tree at the top level;
version 2 holds `windows: [{ name, layout, activeId, zoomedId, rootPaneId,
layoutName }]` plus `activeWindow`. `normalizeSnapshot()` in the background is the
single migration point: it accepts both versions, wraps a v1 tree as one window
named `main`, and returns the normalized v2 form, which is what gets stored and
what `persist-load` hands the client. The content script therefore only ever applies
v2 and never carries migration code.

**Validation.** Every snapshot is normalized and checked whole before storing and
again before handing one back: version, window count ≤ 6, node kinds, directions,
ratios in 1–99%, URL strings, ≤ 12 panes per window, ≤ 24 panes in total, depth
≤ 32, ≤ 96 KB, and window names sanitized to 32 printable characters. A rejected
snapshot is deleted and reported as "no snapshot", never partly applied.

**Housekeeping.** `tabs.onRemoved` deletes that tab's key; `onStartup`/`onInstalled`
prune session keys for tabs that no longer exist; where `storage.session` is
missing the tab layer falls back to `local` with a 6 hour expiry.

### 18. **Key resolution and diagnostics**
`bmuxBindingKeys(event)` returns every name a table could use for one keystroke,
most specific first: `Alt+<key>`/`Alt+<code>` when Alt is held, otherwise `<key>`,
then `Shift+<code>`, `<code>`, `Shift+<key>` and the lowercase character.
`bmuxKeyBinding(mode, event)` walks that list against `BMUX_KEYBINDINGS[mode]`, so a
keyboard that reports `5` (or `%`) for Shift+5 hits the same command; both tables
carry explicit `Shift+Digit5`/`Digit5`/`5` and `Shift+Quote`/`Quote`/`'` aliases.

`handleKey` checks the `Ctrl+b` prefix **before** Control Mode, so the prefix works in
every mode. Each handled key is recorded by `recordKey` (raw key, code, modifiers,
mode, resolved command; the last 20 are kept), an unbound key logs
`Unbound key: ...`, and the `keys` command prints that log — which is how a shortcut
that silently does nothing can be identified.

### 19. **Palette, optional debug window and detached consoles**
- The palette lives in CSS custom properties on `#bmux-overlay` (`--bmux-bg*`,
  `--bmux-text*`, `--bmux-accent*`), with a `[data-theme="classic"]` block
  restoring the black/green look. `setTheme()` sets the attribute; Control Mode is
  `.bmux-control-active` (a one-pixel inset ring) plus `.bmux-status-active` on the
  status chip — no inline border.
- The debug window carries `.bmux-debug-hidden` unless `debugOpen`; `debug` toggles
  it. `verbose` makes `log()` mirror into the focused pane's console, which is what
  makes the window genuinely optional. `info` renders `infoReport()`, built from the
  same primitives (`getPanes`, `getPaneSizeLabel`, `recentKeys`, prefs).
- `setPaneConsoleFloating(pane, true)` moves the pane's `.bmux-pane-output` element
  into a `.bmux-floating-console` in `#bmux-floating` (header with a dock button,
  corner and bottom-edge grips); docking moves the same element back into the
  footer. Because it is the same node the scrollback, listeners and history
  survive. `pane._bmuxFloat` holds the wrapper, so killing the pane removes it.
  `paneConsole(pane)` is the single lookup used by every console method, so `log`,
  `clear` and output appends work whether the panel is docked or floating.
- The snapshot grew `prefs { theme, debugOpen, verbose }` and, per console,
  `floating` + `floatRect`, all restored by `applySnapshot`.
- `isTypingTarget(event)` now checks the event target as well as
  `document.activeElement`, so a keydown aimed at a BMUX input is never swallowed by
  Control Mode (this is what made a hidden debug input unusable).

### 20. **Script files (`.bmux`)**
A script is commands, not code. `bmuxParseScript(text)` (in `content/scripts.js`)
turns the file into `{ index, line, text, sleep }` entries — stripping comments
(`#`, `//`, `#!`), blanks and a pasted `>`/`$` prompt — and refuses the whole file
with a line number if it breaks a limit (500 commands, 2000 characters per line,
64 KB). No command is special-cased: `BMUXClient.runScript()` runs each entry
through `runCommand()`, the same dispatcher every other entry point uses.

**Pacing.** `sleep` is an ordinary command (`sleepSeconds()` on the client), so it
works in a script and in a `;` chain alike. The pause is a cancellable promise held
in `this.sleepState`; `cancelSleep()` resolves it early, which is how `script stop`
ends a `sleep 30` immediately instead of waiting it out.

**Runner state.** `this.scriptRun = { name, total, index, stopped }` is the single
source of truth: `script stop` sets `stopped` and cuts the sleep, the loop checks
it before each line, and `runCommand('script …')` refuses to start a second run
while it is set (a script cannot start a script, so Stop always means something).
A failing line is logged and the loop continues — shell `;` semantics — and the
summary counts the errors.

**Panel.** `#bmux-script-panel` is part of the injected overlay (textarea, Run /
Stop / File / ×, a progress line and a hidden `<input type=file accept=".bmux">`),
so `script file` uses a real file picker and `FileReader`; nothing is read from
disk behind the user's back. The panel is not persisted: it is a tool for the
session, and a running script dies with the page anyway.

**Why scripts cannot click.** A prompt is answered by a human event, so a script
that opens one waits for it (or the 15 s timeout). The shipped demo passes `-y` to
the filter commands and leaves the clickable card to the person driving the demo.

### 21. **Pane inspection and cookies**
A pane is an iframe, so the code that can answer questions about it is the code
*inside* that iframe. `content/inspect.js` is loaded into every frame (`all_frames`)
and speaks a two-message protocol with its parent:

```
parent -> pane : { __bmuxInspect: <nonce>, kind: 'storage'|'forms'|'scripts'|
                                    'resources'|'outline'|'find-text'|'frame-id',
                   args: {…} }
pane -> parent : { __bmuxInspectReply: <nonce>, ok, result | error }
```

`BMUXClient.inspectPane(pane, kind, args, timeout)` posts into
`iframe.contentWindow` (which works across origins — `postMessage` is allowed,
`contentWindow.location` is not), keeps a `nonce -> { resolve, timer, source }` entry
and resolves on the reply, on a 1.5 s timeout, or on a failure to post. A reply is
only accepted from the pane's own window, and inspect.js only answers requests whose
`event.source` is its parent, so the channel is not an oracle for the page. Handlers
may be synchronous (DOM reads) or return a promise (`frame-id`).

**Why it matters**: `list-storage`, `list-forms`, `list-scripts`, `list-resources`,
`outline` and `find-text` work on cross-origin panes, where `source`, `filter` and
`capture-pane` cannot. `find-text` also draws its boxes *inside* the pane's document,
so they survive BMUX redraws.

**`eval`** is the exception: MV3 forbids `eval`/`new Function` in a content script
(the extension CSP blocks them — the first implementation failed exactly there, and
an inline `<script>` injected from the isolated world was refused too). So the pane
reports its own `frameId` (`frame-id` → `chrome.runtime.sendMessage`, answered by the
background from `sender.frameId`), and the top frame asks the background to run the
expression with `chrome.scripting.executeScript({ target: { tabId, frameIds },
world: 'MAIN', func })`. That runs in the page's own world with real page globals; the
injected function serialises the value in-page (nodes as `<h1#id>`, arrays capped at
50, depth 3) because only JSON-serialisable values cross back. The frame id is cached
on the pane (`dataset.bmuxFrameId`) and dropped when the pane is destroyed.

**Cookies** are brokered by the background through the `cookies` permission
(`cookie-list`, `cookie-set`, `cookie-remove`), because `httpOnly` is invisible from
any frame. The commands pass the pane's URL, so the jar is the right origin's;
`list-cookies --export netscape` renders a jar from the same records.

### 22. **Palettes, output formatting and pointer focus**

**Palettes are variables, not code.** `#bmux-overlay` declares the frost palette as CSS
custom properties (`--bmux-bg`, `--bmux-line`, `--bmux-text`, `--bmux-accent`, …) and
every surface — toolbar, footers, consoles, panels, status bar, prompt cards — reads
those variables. Each extra palette is one block,
`#bmux-overlay[data-theme="midnight"] { … }`, setting the same names, so
`setTheme()` is a single `dataset.theme` assignment plus a save. The names live in
`BMUX_THEMES` (`content/commands.js`) next to the other vocabulary; `setTheme` falls
back to `frost` for anything unknown, so a corrupt stored value cannot leave the UI
unstyled. Seven palettes ship: frost (default), classic, midnight, amber, light, nord,
rose.

**Output is formatted in one place.** `BMUXClient.formatTable(columns, rows)` draws
box-drawn tables (`┌─┬─┐`, a header row, a rule, `└─┴─┘`), right-aligns columns whose
cells are all numeric, ellipses cells to fit `BMUX_TABLE_MAX_WIDTH` (96 characters) by
shrinking the widest column first, and `formatValue()` routes lists of records through
it while keeping a lone object as pretty JSON. Every listing command uses it, so a new
command gets consistent output for free.

**Pointer focus works through the frame relay.** A click on a page lands in the pane's
iframe, and moving between two iframes never blurs the top window — which is why only
the footer used to change the active pane. Frames now report activity
(`document.pointerdown` and `window.focus` → `parent.postMessage({ __bmuxPaneFocus: true })`),
and the top frame maps `event.source` back to the pane whose `iframe.contentWindow` it
is. `handlePaneFocus()` answers before `handleInspectReply()` in the single message
listener; a window that BMUX does not own is ignored. The old
`syncActivePaneFromFocus()` path (top window blur with an iframe as `activeElement`)
stays as a backstop for keyboard focus.

### 23. **The extension menu, the editable toolbar and help**

**The menu** (`popup/`) is two buttons and a status line. Toggle asks
`chrome.tabs.query({active, currentWindow})` for the tab and sends it
`{ command: 'toggle-bmux' }` — the same message the icon used to trigger directly, so
activation still has exactly one implementation (`toggle()` in the content script).
Settings calls `chrome.runtime.openOptionsPage()`. The popup cannot read another
tab's DOM, so it never guesses the overlay's state: Toggle is a verb, not a switch.

**The toolbar is configuration.** `background/main.js` owns
`chrome.storage.local → toolbar:buttons`, a list of `{ label, command }` pairs
(default: 16 buttons; `MAX_TOOLBAR_BUTTONS` 24, label ≤ 24 chars, command ≤ 120). The
background validates *shape* only — it cannot see the registry — while the settings
page (`settings/`, which loads `content/scripts.js` and `content/commands.js` so it has
the real `BMUX_COMMANDS`) and the content script's `sanitizeToolbar()` provide the
semantic check: a button whose first token is not a registered command is refused in
the editor and skipped with a log line at render time. `renderToolbar()` draws
`#bmux-toolbar-buttons` from that list and wires each button to
`runCommandAndLog(command)`, so a custom button cannot behave differently from a typed
command. `loadToolbar()` asks the background on activation; the built-in set renders
first so the overlay is never empty.

**The version is in the menu.** `renderToolbarBrand()` puts
`chrome.runtime.getManifest().version` next to the wordmark (`BMUX v1.0.0`), and the
popup footer shows the same number; when the runtime cannot answer, the chip stays
empty rather than guessing.

**Help is data.** `BMUX_HELP` in `content/commands.js` carries, per command,
`category`, `sub`, `args`, `flags`, `examples`, `notes`, `related` and `aliasOf`;
`BMUX_HELP_CATEGORIES` is the ordered category tree. `help` renders category tables
(sub-tables included) from the registry plus that metadata, `help <category>` and
`help <category>/<sub>` narrow it, `help overlay`/`help pane` filter by scope,
`help <command>` renders the summary, usage, arguments table, flags table, examples,
notes, aliases, category and a docs pointer, and `help <filter>` searches names and
descriptions. Because the metadata is data, a new command
documents itself by adding one entry — and the harness fails if a command has none.

### 24. **Modern UI Design**
- **Glassmorphism**: semi-transparent backdrop with blur
- **Toolbar**: window actions, then focus / zoom / layout buttons on the right
- **Draggable, resizable debug console**: floating, scrollback, runs any command
- **Per-pane footer**: title, `>` command input, status segment (filter names),
  console toggle, maximize button, `[number id]` badge, and a resizable console
  panel
- **Status bar**: `[CONTROL MODE]`/`[NORMAL]` on the left, focused pane and size
  (plus `· ZOOM`) on the right
- **display-panes**: large numbers over each pane while picking

## How to Use

### Installation
1. Load the extension in Chrome (the only browser this has been run in):
   - `chrome://extensions` → Enable Developer Mode → Load Unpacked
2. Navigate to the BMUX folder and select it

### Basic Workflow
1. **Activate BMUX**: `Alt+Shift+B` or the toolbar icon
2. **Split**: `%` / `"`, the `Split H`/`Split V` buttons, or
   `split-window -h -l 30%`
3. **Resize**: drag a boundary, or `Alt+arrow` / `resize-pane -R 5`
4. **Arrange**: `select-layout main-vertical`, `swap-pane 1 2`, `rotate-window`
5. **Focus**: click, arrows, `q` + digit, `focus-pane %2`, `o` / `;`
6. **Zoom**: `z`
7. **Keep it**: it is saved per tab as you go (`persist status`), named layouts
   with `save-layout work`, `.bmux` scripts with `script file` / `script demo`
8. **Exit**: `d`, `Detach`, or the toolbar icon again

## Architecture

### File Structure
```
BMUX/
├── manifest.json          # Extension configuration (v0.7.0)
├── background/
│   └── main.js           # Service worker (relay + layout persistence)
├── content/
│   ├── main.js           # Client: overlay DOM, layout engine, focus, dispatcher, script runner
│   ├── commands.js       # Command registry + key bindings (source of truth)
│   ├── inspect.js        # frame-side inspection: storage, forms, scripts, eval id
│   ├── scripts.js        # .bmux format: parser, sleep arguments, built-in demo
│   └── styles.css        # UI, split handles, panels, drag shield
├── examples/
│   ├── demo.bmux         # Site-agnostic demo (what `script demo` runs)
│   └── dtrh-tour.bmux    # Three-page tour of dtrh.net (screenshot/recording)
├── popup/                 # The extension menu: Toggle + Settings (popup.js/css)
├── settings/              # Toolbar editor (loads the registry to validate commands)
└── (the icon opens the menu; Alt+Shift+B toggles directly)
```

`manifest.json` loads `content/scripts.js`, then `content/commands.js`, then
`content/main.js`, so the `.bmux` parser and the registry both exist before the
client is constructed. The scripts file holds no commands of its own: it is the
format (parser + `sleep` arguments + the built-in demo text), which is why the
registry and the runner can both use it.

### Message Flow

**Toolbar icon:**
1. `chrome.action.onClicked` in the background →
2. `content/main.js` receives `toggle-bmux`: show the overlay and enter Control Mode,
   or hide it and leave Control Mode

**Global Hotkey:**
1. Browser triggers `toggle-bmux-mode` →
2. `background/main.js` receives it and sends `toggle-control-mode` to the tab →
3. Every frame's content script (`all_frames: true`) sets Control Mode, so keys
   pressed inside a pane's iframe are still captured

**In-Mode Commands (top frame):**
1. User presses `%`, `:`, an arrow key, `Alt+arrow`, `z`, `q`, `o`, `;` or `Space`
   in Control Mode →
2. `content/main.js` resolves the key through `BMUX_KEYBINDINGS` →
3. `runCommand()` looks the command up in `BMUX_COMMANDS` and calls `execute`

**Persistence:**
1. The content script changes the layout (or the tab is hidden/unloaded) ->
2. `scheduleSave()` / `saveNow()` sends `persist-save { snapshot }` ->
3. The background validates it and writes `layout:tab:<sender.tab.id>` ->
4. On the next load the content script asks `persist-load` and applies the answer
   before its first render

**In-Mode Commands (inside a pane's iframe):**
1. User presses a key while focus is in a pane's iframe →
2. That frame's content script resolves the key to a command line and sends
   `relay-line` with `{ line }` to the background →
3. Background relays `execute-line` with `{ line }` to the tab →
4. The top frame runs the line

The relay carries a **command line**, not an action name, so the background never
needs to know which commands exist. Adding a command or a key binding is a change
to `content/commands.js` only.

## Browser Compatibility

### Chromium (Manifest V3) - verified
- Chromium 150 with the extension unpacked: the whole verification suite runs here
  (layout, keys, filters, prompts, persistence, scripts, a real `page.reload()`).
- Global hotkey `Alt+Shift+B`, `chrome.action.onClicked`, `commands`,
  `declarativeNetRequest`, `storage.session` all exercised.
- Chrome and Edge are the same engine; only Chromium has been tested.

### Firefox - not verified
- The manifest is Manifest V3 with `background.service_worker`, which Firefox reads
  differently (`background.scripts` / event pages), and `declarativeNetRequest`
  support differs by version.
- No test has been run on Firefox, so the honest statement is *untested*, not
  supported. It is on the roadmap, not in this release.

## Known Issues and Limitations

1. **First Load**: If extension doesn't activate, reload the page once after installing
2. **Iframe Sandbox**: Some sites block iframes (e.g., Google, Facebook)
3. **Hotkey Conflicts**: If `Alt+Shift+B` is taken, change in `chrome://extensions/shortcuts`
4. **Restored panes load fresh**: a page cannot be cloned live, so scroll
   position, form input and in-page state are lost on restore
5. **Windows are capped at six per tab**, and a hidden window keeps its iframes
   running — that is the cost of switching without reloading
6. **No floating panes, break/join pane, or input broadcasting**
7. **Mouse only**: resizing requires a pointer; touch is not handled
8. **Cross-origin panes** cannot be inspected or boxed (`source`, `filter`,
   `capture-pane`); navigation, reload, sizing and reordering work regardless
9. **Filter boxes are measured when drawn**: pages that move elements without
   mutating the DOM (CSS transitions) need the filter re-run
10. **`kill-pane` refuses the last pane**; use `reset-layout` to reset the window
11. **`new-window` changed meaning in 0.7.0** (create a window, not reset a pane):
    a `.bmux` script or habit from 0.6.0 wants `reset-layout` instead
12. **A `.bmux` script cannot click a prompt**: it waits for a human answer or the
    15 s timeout. The demos pass `-y` instead
13. **A script does not survive a navigation**: a reload or a new tab destroys the
    runner, so the persistence round trip stays manual; the script panel is not
    saved with the layout either
14. **Scripts are not code**: no variables, loops or branches, and no file or
    network access — a script is a list of commands you could have typed
15. **`eval` needs the page's consent**: a CSP that forbids `unsafe-eval` refuses the
    expression (reported, not worked around); `source`, `filter` and `capture-pane`
    still require a same-origin pane
16. **Inspection answers are capped** (200 entries, 4000 text nodes), and
    `find-text` boxes are a snapshot: scrolling the page does not move them

## Troubleshooting

### "Extension doesn't work"
1. Reload extension in `chrome://extensions`
2. Refresh the web page
3. Open browser console (F12) and check for errors
4. Verify content script loaded: look for `BMUX Client Loading...` (and the
   `TOP`/`FRAME` line after it) in the page console

### "Keyboard shortcuts don't work"
1. Check if Control Mode is active (inset ring, `CONTROL MODE` chip in the status bar)
2. Click the page body once: while a console or pane input has focus, typing goes
   there on purpose
3. Verify hotkey isn't conflicting: `chrome://extensions/shortcuts`
4. Use toolbar buttons as fallback

### "Focus won't move"
1. `list-panes` — if there is one pane, split first (`split-window -h`)
2. Watch the debug console: each move logs `Focus <dir>: pane N/M` or an error
3. If the pane is zoomed, a directional move unzooms first

### "Resizing does nothing"
1. A drag needs a split boundary: `list-panes` shows the sizes
2. `resize-pane -L/-R` needs a side-by-side split, `-U/-D` a stacked one
3. Zoomed panes cannot be resized until `resize-pane -Z`

### "Splits aren't rendering"
1. Open Debug Console (should auto-appear)
2. Check for `Split horizontal: 50/50` log messages
3. Use browser DevTools to inspect `#bmux-panes` (panes are absolutely positioned)

## Credits

Inspired by TMUX terminal multiplexer.
Built as a cross-browser extension for modern web development workflows.
