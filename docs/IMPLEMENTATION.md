# BMUX Implementation Summary

## Current Status (0.1.0)

BMUX is fully functional with the following features implemented.

### 1. **Popup Control**
Located in the browser extension icon menu, you can:
- **Show/Hide Overlay**: Toggle the BMUX interface on/off manually
- **Toggle Control Mode**: Enter/exit keyboard command mode
- **New Session**: Create a new BMUX session

### 2. **Global Hotkey (Alt+Shift+B)**
- Registered in `manifest.json` as a browser-level shortcut
- Cannot be blocked by websites
- Toggles "Control Mode" on/off
- Works across all tabs and iframes

### 3. **Control Mode**
When activated (via `Alt+Shift+B` or popup button):
- Thick blue border appears around the overlay
- Status bar shows `[CONTROL MODE]` with blue background
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

### 7. **Focus model**
- The active pane is the one with the `active` class (blue border), always set
  explicitly by `setActivePane`.
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
  into a height clamped to 40px … 70% of the pane, and double-click resets it.
- `log toggle|on|off|clear|size <px>` and the `l` key are the command-line and
  keyboard equivalents; `clear` empties the scrollback.
- There is no auto-collapse: a command opens the console and leaves it open.

### 12. **Filter presets and confirmation**
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

### 13. **Command chains**
`splitCommandLine` splits a line on top-level semicolons (`;` outside quotes and
`[] () {}`; `\;` is literal) and `runLine` executes the segments one after
another, awaiting each. Every entry point (debug console, `:` line, pane input,
key dispatch, background relay) goes through `runLine`, so chaining works
everywhere; the pane console echoes and reports each segment separately.

Because segments are awaited, a command that raises a prompt blocks the rest of
the chain until the prompt is answered — which is what makes
`filter links; list-panes` show the refined result in the second segment.

### 14. **Prompts**
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

### 15. **Per-pane maximize**
Every pane footer carries a `⤢` / `⤡` button. A click runs `resize-pane -Z` for
that pane through the dispatcher, so the pane button, `z` / `Shift+z`, and the
toolbar `Zoom` button all change one piece of state (`zoomedPane`);
`refreshPaneControls` syncs the glyphs from the render path.

### 16. **Modern UI Design**
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
1. Load the extension in Chrome/Firefox:
   - Chrome: `chrome://extensions` → Enable Developer Mode → Load Unpacked
   - Firefox: `about:debugging` → Load Temporary Add-on
2. Navigate to the BMUX folder and select it

### Basic Workflow
1. **Activate BMUX**: `Alt+Shift+B`, the toolbar, or the popup
2. **Split**: `%` / `"`, the `Split H`/`Split V` buttons, or
   `split-window -h -l 30%`
3. **Resize**: drag a boundary, or `Alt+arrow` / `resize-pane -R 5`
4. **Arrange**: `select-layout main-vertical`, `swap-pane 1 2`, `rotate-window`
5. **Focus**: click, arrows, `q` + digit, `focus-pane %2`, `o` / `;`
6. **Zoom**: `z`
7. **Exit**: `d`, `Detach`, or the popup

## Architecture

### File Structure
```
BMUX/
├── manifest.json          # Extension configuration (v0.1.0)
├── background/
│   └── main.js           # Service worker (global state & message relay)
├── content/
│   ├── main.js           # Client: overlay DOM, layout engine, focus, dispatcher
│   ├── commands.js       # Command registry + key bindings (source of truth)
│   └── styles.css        # UI, split handles, drag shield
└── popup/
    ├── index.html        # Extension icon popup
    └── script.js         # Popup button handlers
```

`manifest.json` loads `content/commands.js` before `content/main.js`, so the
registry and key bindings exist before the client is constructed.

### Message Flow

**Popup Button Click:**
1. `popup/script.js` sends `toggle-bmux` or `toggle-control-mode` to the tab →
2. `content/main.js` toggles the overlay or Control Mode

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

### Chrome/Edge (Manifest V3)
- ✅ Fully supported
- Global hotkey: `Alt+Shift+B`
- Commands API works perfectly

### Firefox
- ✅ Mostly supported (use Manifest V2 for better support)
- May need to adjust `manifest.json` for full compatibility
- Global hotkeys work via `commands` API

## Known Issues and Limitations

1. **First Load**: If extension doesn't activate, reload the page once after installing
2. **Iframe Sandbox**: Some sites block iframes (e.g., Google, Facebook)
3. **Hotkey Conflicts**: If `Alt+Shift+B` is taken, change in `chrome://extensions/shortcuts`
4. **No persistence**: the layout lives in the page, so a reload starts over
5. **No multiple windows / layout tabs**: `new-window` resets the overlay
6. **No floating panes, break/join pane, or input broadcasting**
7. **Mouse only**: resizing requires a pointer; touch is not handled
8. **Cross-origin panes** cannot be inspected or boxed (`source`, `filter`,
   `capture-pane`); navigation, reload, sizing and reordering work regardless
9. **Filter boxes are measured when drawn**: pages that move elements without
   mutating the DOM (CSS transitions) need the filter re-run
10. **`kill-pane` refuses the last pane**; use `new-window` to reset

## Troubleshooting

### "Extension doesn't work"
1. Reload extension in `chrome://extensions`
2. Refresh the web page
3. Open browser console (F12) and check for errors
4. Verify content script loaded: Look for "BMUX Client Loading..." in console

### "Keyboard shortcuts don't work"
1. Check if Control Mode is active (blue border, `[CONTROL MODE]` in the status bar)
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
