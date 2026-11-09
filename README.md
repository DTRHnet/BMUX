# BMUX - Browser Multiplexer

**Version 0.4.0**

A Chrome/Firefox extension inspired by TMUX that transforms your browser into a powerful terminal-style multiplexer. Split your browser window into multiple independent panes, each displaying different web content — and rearrange them without reloading a single page.

![BMUX Version](https://img.shields.io/badge/version-0.4.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

> **New in 0.4.0:** commands chain with `;` (`filter img; filter a`), commands can
> ask questions you **click** (cards with buttons, digits or `y`/`n`), `filter`
> draws then narrows in rounds (*inside a container*, *text contains*, *visible
> only*, *unique targets*), filters accumulate, and every pane has its own `⤢`
> maximize button.
>
> **New in 0.3.0:** the per-pane console is a real scrollback (opens, stays
> open, scrolls, drag to resize, `l` or `log toggle`), `filter` understands preset
> words (`filter links internal`) and asks yes/no before boxing a preset or a big
> result, and `Shift+z` maximizes a pane like tmux.
>
> **New in 0.2.0:** `filter` is now a visual tool — it boxes every match inside
> the pane, names each one in the pane's status line as you hover it, and clears
> with `Esc` or `filter -c`.
>
> **New in 0.1.0:** percentage splits, mouse-draggable split boundaries, zoom,
> layout presets, real `kill-pane`, pane titles, swap/rotate, `display-panes`,
> `capture-pane`, and a ratio-driven layout engine that never reparents a pane —
> so re-layouting does not reload anything. See [CHANGELOG.md](CHANGELOG.md).

---

## 🚀 Quick Start

### Installation

1. **Clone or Download** this repository
2. **Open Chrome**: Navigate to `chrome://extensions`
3. **Enable Developer Mode** (top-right toggle)
4. **Load Unpacked**: Click and select the `BMUX` folder
5. **Refresh** any open tabs to activate

### Basic Usage

1. **Activate BMUX**: Press `Alt+Shift+B` or click the extension icon
2. **Split Horizontally**: Press `%` (Control Mode) or click `Split H`
3. **Split Vertically**: Press `"` (Shift+') or click `Split V`
4. **Resize**: drag the boundary between panes with the mouse, or press
   `Alt+←/→/↑/↓`
5. **Move focus**: click a pane, use the `Up` / `Down` / `Left` / `Right` toolbar
   buttons, or press an arrow key in Control Mode
6. **Zoom**: press `z` to make the focused pane fill the overlay, `z` again to
   return
7. **Exit Control Mode**: Press `Escape`
8. **Hide Overlay**: Press `d` or click "Detach"

---

## ✨ Features

### 🪟 Splitting with real sizes
- **Horizontal splits** (`%`) - Side-by-side panes
- **Vertical splits** (`"`) - Stacked panes
- **Percentage splits** - `split-window -l 30%` gives the class TMUX gives you:
  a sidebar, a main area, anything from 10% to 90%
- **Placement and focus flags** - `-b` puts the new pane first, `-d` keeps focus
  where it was
- **Unlimited nesting** - split any pane, any number of times

### 📐 Ratio-driven layout engine
- The layout is a **binary split tree** (`direction` + `ratio`), not a pile of
  CSS flex boxes. Every operation edits the tree and recomputes rectangles.
- Rectangles are **fractions of the overlay**, so resizing the browser window
  keeps every pane proportional.
- **Nothing is ever reparented.** Panes are absolutely positioned, so splitting,
  changing layout, swapping and rotating **do not reload the pages you are
  looking at** — which is impossible to get right while moving iframes around.

### 🖱️ Mouse-first resizing
- Grab the boundary between two panes and drag. Handles are 8 px wide with a
  hairline marker, a hover highlight and a proper `col-resize`/`row-resize`
  cursor.
- **Double-click a boundary** to reset that split to 50/50.
- A drag shield covers the overlay while you drag, so the pointer never slips
  onto an iframe and stalls the resize.
- **Click to focus**: click a pane's body, footer, or inside its iframe.

### 🔍 Zoom
- `resize-pane -Z` (or `z`) makes one pane fill the overlay.
- The other panes are **hidden, not destroyed** — their pages keep running,
  their scroll position and state intact.
- Marked in the status bar (`· ZOOM`) and in `list-panes` (`[ZOOM]`);
  any directional focus move unzooms first.

### 🧩 Layout presets
- `even-horizontal`, `even-vertical`, `main-vertical`, `main-horizontal`, `tiled`
- `select-layout <name>` or `next-layout` (`Space`) to cycle
- Presets rebuild the tree only, so no page reloads

### 🔀 Reordering
- `swap-pane <a> <b>` - two panes trade places
- `rotate-window` - every pane moves one slot along the layout
- Both keep the iframes exactly where they are in the DOM, so nothing reloads

### 🎯 Pane navigation
- **Four toolbar buttons** - `Up`, `Down`, `Left`, `Right`
- **Arrow keys** - in Control Mode, or after the `Ctrl+b` prefix
- **Wrap-around** - with two panes side by side and focus on the right one,
  `Right` moves to the left pane. No dead ends at the edge of a layout.
- **Geometric** - the nearest pane in that direction wins, with a penalty for
  drifting off-axis, so the pane straight ahead beats one off to the side.
- **`display-panes`** - shows each pane's number over it; press a digit to jump
  there (`q` in Control Mode)
- **`cycle-pane next|prev`** and **`last-pane`** (`o` and `;`)
- **Every move is logged** - e.g. `Focus right: pane 1/2 (wrapped)`

### ⛓️ Chained commands
`;` runs commands one after another, from the console, the `:` line, a pane input
or a key binding:

```
> filter img; filter a          # box images and links together
> split-window -h; list-panes   # split, then show the result
```

- Segments run **awaited**, so a question raised by one is answered before the
  next starts.
- A failing segment does not stop the chain, and each gets its own echo.
- `\;` is a literal semicolon; a `;` inside quotes or `[] () {}` does not split,
  so `filter a[href="x;y"]` stays one command.

### ❓ Prompts you can click
When a command needs an answer, a card appears above the pane's footer:

```
┌─ 23 links found and labelled. Specify harder constraints? ──┐
│ links (a[href]) · 23 box(es) on screen                      │
│ [ Yes, refine 1 ]  [ No, keep these 2 ]                     │
└─────────────────────────────────────────────────────────────┘
```

Click a button, press its digit, press `Enter` for the primary choice, use
`y`/`n` on yes/no cards, type `yes` / `no`, or `Esc` to cancel. It never steals
focus from a text field, and keys pressed with the focus inside the pane work too.
Prompt cards are a command-API feature (`api.ask` / `api.askText`), so any future
question uses the same UI.

### ⤢ Maximize any pane
Every pane footer has a `⤢` button: click it to maximize that pane (the on-screen
form of `Ctrl+b`, `Shift+z`), click `⤡` to restore. Clicking another pane's `⤢`
moves the maximize there. Keyboard (`z`, `Shift+z`), the toolbar `Zoom` button and
the pane buttons share one state.

### 💻 Per-pane console you can actually read
The console under each pane's input is a scrollback, not a flash message:

- Every command and its result is appended and kept (100 blocks), with a
  **scrollbar**.
- It **stays open** — the five-second auto-collapse is gone.
- A toggle button in the footer (`▸` / `▾`), the `l` key, or `log toggle` opens
  and closes it whenever you like.
- **Drag its top edge** to make it taller (up to 70% of the pane; double-click to
  reset; `log size 240` works too). The height and open state survive splits,
  layout changes and zoom.
- `clear` empties the scrollback.

### 🔎 Filter highlighting
`filter` inspects a same-origin pane and *shows* you what matched:

```
> filter .card
=== 2 match(es): ".card" ===

[1] DIV#alpha.card "Product card"
[2] DIV.card "Beta card"

Boxed 2 of 2 match(es). Hover one to name it in the pane status line; Esc or "filter -c" clears.
```

- Every match gets a **box** in the pane: 2px outline, light wash, and 7px corner
  ticks so a tiny or zero-height element is still visible, with a numbered tab.
- **Hover a match** and the pane's footer status line names it —
  `FILTER: .card - DIV#alpha.card "Product card" · 1/2` — and the box turns green.
  Move away and it falls back to `FILTER: .card · 2 match(es)`.
- **Live**: a MutationObserver re-queries and redraws when the page changes.
- **Preset words** expand into whole queries, with variants that need a real
  predicate rather than a selector:
  `filter links` · `filter links internal` · `filter links external` ·
  `filter images large` · `filter images noalt` · `filter headings` ·
  `filter text` · `filter text main` · `filter inputs` · `filter buttons` ·
  `filter tables rows` · `filter media video` · `filter prices` ·
  `filter comments` · `filter authors` · `filter dates` ·
  `filter articles headlines` · `filter forms` · `filter code` · `filter main`.
  `filter --presets` prints the vocabulary with the selector behind each word.
- **It draws first, then offers to narrow** when you use a preset or match more
  than 25 elements: `23 links found and labelled. Specify harder constraints?`
  → *Yes, refine* opens a card with **Inside a container…**, **Exclude a
  container…**, **Text contains…**, **Visible only**, **Unique targets**,
  **Keep these** and **Cancel**. Each round narrows the current set, re-labels the
  boxes and asks again (max 6 rounds).
- **The same narrowing without the questions**:
  `filter links --in main --text price --visible --unique href`
  (`--replace` starts a clean set, `-y` skips all prompts).
- `filter -l .card` lists without drawing, `filter -n 50 .card` caps the boxes
  (default 200), `filter -c` clears, `filter -y …` skips the questions.
- **Filters accumulate**: `filter img; filter a` boxes both; `--replace` starts
  over and `filter -c` clears everything.
- **`Esc` clears the boxes** — before it does anything else, from the top frame,
  from an input, or with the focus clicked inside the pane. A second `Esc` still
  leaves Control Mode.
- Nothing is injected around your page's elements: the boxes are sibling
  overlays in the pane document, so the page's layout is untouched.
- **Same-origin only** — a cross-origin pane cannot be measured or written into,
  and `filter` says so.

### 🏷️ Pane identity and titles
- **Numbers** - layout order (top-to-bottom, left-to-right), recomputed after
  every structural change so they always run 1..n
- **Ids** - `%1`, `%2`, … assigned once when a pane is created and never reused
- **Badge** - every pane footer shows `[number id]`, e.g. `[2 %2]`
- **Titles** - `rename-pane <title>`; otherwise the page `<title>` (same-origin)
  or the URL is used
- **`list-panes`** - number, id, size, active/zoom marker, title and URL, with
  `-j` for JSON

### 🎮 Dual control systems

#### Control Mode (Alt+Shift+B)
- **No prefix needed** - Direct keyboard commands
- **Visual indicator** - Blue border when active
- **Modal editing** - Like Vim's command mode

#### Legacy Mode (Ctrl+b)
- **TMUX-style prefix** - Classic two-key combos
- **Works everywhere** - Including input fields
- **Fallback option** - When hotkeys conflict

### 💻 Per-Pane Console
Every pane has a TMUX-style command input at the bottom:

```
> help              # List all commands
> source            # View HTML source in console
> filter div        # Find all div elements
> capture-pane      # Print the visible text
> url google.com    # Navigate to URL
> focus-pane 1      # Focus the pane numbered 1
```

### 🛠️ Extensible Commands
One registry defines every command — overlay and pane alike — in
`content/commands.js` (see [`docs/ADDING_COMMANDS.md`](docs/ADDING_COMMANDS.md)):

```javascript
'mycommand': {
    scope: 'pane',                      // 'overlay' or 'pane'
    description: 'What it does',
    usage: 'mycommand <arg>',
    execute: async function(api, args) {
        const pane = api.pane;          // api = { client, pane, log }
        // Your code here
        return 'Result message';
    }
}
```

### 🌐 CSP Header Removal
Loads sites that normally block iframes (GitHub, Google, Facebook, etc.)
- Uses Chrome's `declarativeNetRequest` API
- Only affects BMUX panes
- See [`docs/CSP_HANDLING.md`](docs/CSP_HANDLING.md) for details

### 🔒 Cross-Origin Safety
Graceful handling of cross-origin restrictions:
- Safe helper functions
- Clear error messages
- Fallback strategies
- See [`docs/CROSS_ORIGIN.md`](docs/CROSS_ORIGIN.md) for details

---

## 📋 Commands

Commands can be run from the toolbar, the debug console (`$` prompt), the `:`
line in Control Mode, or a pane's input (`>` prompt). One dispatcher runs them all:
`content/main.js` parses the line, looks it up in `content/commands.js` and calls
the command with an `api` object.

### Overlay Commands

These act on the whole overlay.

| Command | Description | Example |
|---------|-------------|---------|
| `help` | List every command, grouped by scope | `> help` |
| `list-panes [-j]` | Number, id, size, marker, title, URL (`-j` = JSON) | `> list-panes` |
| `focus-pane <n\|%id\|dir>` | Focus by number, id, or direction (`up`/`down`/`left`/`right`, wraps) | `> focus-pane %2` |
| `last-pane` | Focus the pane that was active before | `> last-pane` |
| `cycle-pane [next\|prev]` | Focus the next or previous pane in layout order | `> cycle-pane prev` |
| `split-window [-h\|-v] [-l size] [-b] [-d]` | Split the active pane, optionally with a size | `> split-window -h -l 30%` |
| `kill-pane [n\|%id]` | Close a pane; the last pane is refused | `> kill-pane %2` |
| `resize-pane [-L\|-R\|-U\|-D n] [-x size] [-Z]` | Move the boundary, set the size, or zoom | `> resize-pane -R 5` |
| `select-layout <name>` | `even-horizontal`, `even-vertical`, `main-vertical`, `main-horizontal`, `tiled` | `> select-layout main-vertical` |
| `next-layout` | Cycle to the next layout preset | `> next-layout` |
| `swap-pane <a> [b]` | Swap two panes' positions | `> swap-pane 1 2` |
| `rotate-window [-r]` | Move every pane one slot along the layout | `> rotate-window` |
| `display-panes` | Show pane numbers; pick one with a digit | `> display-panes` |
| `new-window` | Reset the overlay to one pane | `> new-window` |
| `detach` | Hide or show the overlay | `> detach` |
| `control-mode [on\|off\|toggle]` | Turn Control Mode on, off, or toggle it | `> control-mode on` |
| `command-prompt` | Open the `:` command line | `> command-prompt` |
| `escape` | What `Esc` does: clear filter highlights, else leave Control Mode | `> escape` |
| `yes` / `no` | Answer the open prompt (`y` / `n` are aliases) | `> yes` |

### Pane Commands

These act on one pane — the pane whose input you typed into, or the active pane
for the console and `:` line.

| Command | Description | Example |
|---------|-------------|---------|
| `source` | View HTML source (transforms pane) | `> source` |
| `restore` | Return from console to browser view | `> restore` |
| `filter <selector> [-n max] [-y] [--in s] [--not-in s] [--text w] [--visible] [--unique] [--replace]` | Box matches, name them on hover, narrow them | `> filter links --in main` |
| `filter <preset> [variant]` | Preset query, e.g. `links internal`, `images large` | `> filter links internal` |
| `filter --presets` | List the preset vocabulary | `> filter --presets` |
| `filter -l <selector>` | List matches without drawing | `> filter -l a` |
| `filter -c` | Clear the highlight boxes | `> filter -c` |
| `capture-pane [-n lines]` | Print the pane's visible text (same-origin) | `> capture-pane -n 20` |
| `rename-pane <title\|->` | Title shown in the pane footer; `-` clears it | `> rename-pane Docs` |
| `url [new-url]` | Show or change pane URL | `> url github.com` |
| `reload` | Reload the pane | `> reload` |
| `log [toggle\|on\|off\|clear\|size px]` | Show, hide, resize or clear this pane's console | `> log size 240` |
| `clear` | Empty the pane console scrollback | `> clear` |

Bad input never throws: an unknown command, an unknown pane, a missing argument,
an unknown flag or an out-of-range size returns a message and leaves the layout
and focus where they were. `constructor`, `__proto__` and similar names are
rejected as unknown commands.

### `list-panes` output

```
> list-panes
Panes:
1 %1   50%x100%   [ACTIVE] Docs - https://example.com/docs
2 %2   50%x100%            GitHub - https://github.com/
```

`-j` prints the same data as JSON with fractional geometry, which is handy for
scripting:

```
> list-panes -j
[
  { "number": 1, "id": "%1", "title": "Docs", "active": true, "zoomed": false,
    "size": { "x": 0, "y": 0, "w": 0.5, "h": 1 }, "url": "https://example.com/docs" }
]
```

### Keyboard Shortcuts

| Key | Action in Control Mode |
|-----|------------------------|
| `Alt+Shift+B` | Toggle Control Mode |
| `%` | `split-window -h` |
| `"` | `split-window -v` (Shift+') |
| `c` | `new-window` |
| `d` | `detach` (hide overlay) |
| `x` | `kill-pane` |
| `←` `→` `↑` `↓` | Move focus, with wrap-around |
| `Alt+←/→/↑/↓` | Resize (move the boundary) |
| `z` / `Shift+z` | `resize-pane -Z` (zoom toggle — the tmux `prefix + Z`) |
| `q` | `display-panes` (press a number to jump) |
| `o` / `;` | `cycle-pane next` / `last-pane` |
| `l` | `log toggle` (open/close this pane's console) |
| `Space` | `next-layout` |
| `:` | `command-prompt` |
| `Esc` | Exit Control Mode (or cancel `display-panes`) |

**Legacy (Ctrl+b prefix)** — the same command set, after `Ctrl+b`:

1. Press `Ctrl+b`
2. Release both keys
3. Press the command key (`%`, `"`, `c`, `d`, `x`, `:`, an arrow key, `Alt+arrow`, …)

Both key tables live in `BMUX_KEYBINDINGS` in `content/commands.js`; each entry is
a command line, so keys are not a second code path.

### Mouse

| Action | Result |
|--------|--------|
| Click a pane body or footer | Focus that pane |
| Click inside a pane's iframe | Focus that pane (cross-origin safe) |
| Drag a boundary between panes | Resize the split |
| Double-click a boundary | Reset that split to 50/50 |
| Drag a pane console's top edge | Resize that console (double-click resets it) |
| Drag the debug console's corner | Resize the floating console |
| Click a pane's `⤢` / `⤡` button | Maximize / restore that pane |

---

## 🗂️ How the layout works

```
        split(row, 0.3)
        /            \
   leaf(%1)      split(column, 0.55)
                  /              \
             leaf(%2)          leaf(%3)
```

- A leaf holds a pane element; a split holds a direction (`row` = side by side,
  `column` = stacked) and the share given to its first child.
- Rendering walks the tree once with the overlay's rectangle, which yields each
  pane's rectangle as fractions.
- `split-window`, `kill-pane`, `resize-pane`, zoom, `select-layout`, `swap-pane`
  and `rotate-window` only edit the tree; the panes stay where they are in the
  DOM. That is why pages keep running.

---

## 📚 Documentation

### User Guides
- **[Command Usage Guide](docs/COMMAND_USAGE.md)** - Every command, every entry point, mouse and layouts
- **[Implementation Overview](docs/IMPLEMENTATION.md)** - Architecture, layout engine, message flow

### Developer Guides
- **[Adding Commands](docs/ADDING_COMMANDS.md)** - How to create custom commands
- **[Cross-Origin Handling](docs/CROSS_ORIGIN.md)** - Understanding browser restrictions
- **[CSP Handling](docs/CSP_HANDLING.md)** - How iframe blocking is bypassed

### Technical Reference
- **[Design Documentation](docs/DESIGN.md)** - Original design specification (historical)
- **[Update Status](docs/UPDATE_STATUS.md)** - 0.0.1 progress tracker (historical)

---

## 🗂️ Project Structure

```
BMUX/
├── manifest.json           # Extension configuration (v0.1.0)
├── rules.json              # CSP header removal rules
├── background/
│   └── main.js            # Service worker (state, message relay)
├── content/
│   ├── main.js            # Overlay DOM, layout engine, focus, dispatcher
│   ├── commands.js        # Command registry + key bindings (source of truth)
│   └── styles.css         # Glassmorphism UI, split handles, drag shield
├── popup/
│   ├── index.html         # Extension icon popup
│   └── script.js          # Popup controls
└── docs/                  # Documentation
    ├── ADDING_COMMANDS.md
    ├── COMMAND_USAGE.md
    ├── CROSS_ORIGIN.md
    ├── CSP_HANDLING.md
    ├── DESIGN.md
    ├── IMPLEMENTATION.md
    └── UPDATE_STATUS.md
```

`content/commands.js` is the single source of truth for commands. `content/main.js`
owns the DOM and the layout, and holds no command definitions, help text or
key-to-action switch.

---

## 🎨 Design Philosophy

### Not a Direct TMUX Clone
BMUX is **inspired by** TMUX but adapted for the browser:

- ✅ Familiar keyboard shortcuts
- ✅ Pane splitting, resizing, zooming, layout presets
- ✅ Command-line interface with a scriptable registry
- ✅ Things a terminal cannot do: mouse-draggable boundaries, live pages that
  survive re-layouting, per-pane inspection of real DOM
- ❌ Not a 1:1 terminal emulator
- ❌ No server, sessions or attached clients

### Modern Browser Experience
- **Glassmorphism UI** - Semi-transparent, blurred backdrop
- **Draggable debug console** - Move it out of the way
- **Per-pane footers** - Title, command input and a `[number id]` badge
- **Visual feedback** - Blue borders, resize handles, zoom markers, focus logs

---

## 🔐 Privacy & Security

### What BMUX Does
- ✅ Removes CSP/X-Frame-Options headers for panes
- ✅ Stores state locally in browser
- ✅ Open source - fully auditable code

### What BMUX Does NOT Do
- ❌ Track your browsing
- ❌ Send data over network
- ❌ Inject ads or modify content
- ❌ Access sites you don't explicitly load

### Permissions Explained
- **`declarativeNetRequest`** - Remove iframe-blocking headers
- **`<all_urls>`** - Apply rules to any site you load
- **`tabs`, `storage`** - Manage panes and save state

See [`docs/CSP_HANDLING.md`](docs/CSP_HANDLING.md) for full security details.

---

## 🐛 Known Limitations

### Browser Restrictions
- **Some sites** may use JavaScript iframe busters (can't be bypassed)
- **Cookie restrictions** may affect third-party content
- **Same limitations** as browser DevTools iframes

### Current Version (0.1.0)
- ⏳ **No sessions or persistence** - the layout lives in the page, so a reload
  starts over
- ⏳ **No multiple windows / layout tabs** - `new-window` resets the overlay
- ⏳ **No floating panes** - every pane takes layout space
- ⏳ **No `break-pane` / `join-pane`**
- ⏳ **No broadcasting** of input to several panes
- ⏳ **Mouse only** - resizing needs a pointer; touch is not handled
- ⏳ **Cross-origin panes** cannot be inspected or boxed (`source`, `filter`,
  `capture-pane`); navigation, reload, sizing and reordering work regardless
- ⏳ **Filter boxes are measured when drawn** — a page that moves elements without
  mutating the DOM (CSS transitions) needs the filter re-run
- ⏳ **A yes/no prompt times out after 15s** (cancelled, boxes stay); text
  prompts wait indefinitely
- ⏳ **Refining narrows what is drawn**, but a page mutation re-queries the
  selectors, so the boxes can re-broaden after a refinement
- ⏳ **Chained filters keep appending** until `filter -c` or `--replace`
- ⏳ **Presets depend on the page's markup** — `prices`/`comments` need
  conventional class names, so plain selectors are the fallback
- ⏳ `kill-pane` refuses the last pane (use `new-window` to reset)

---

## 🛣️ Roadmap

### Version 0.1.0
- [x] Ratio-driven layout engine; no page reloads on split or re-layout
- [x] Percentage splits, `-b` / `-d`
- [x] Real `kill-pane`
- [x] Mouse-draggable split boundaries, double-click reset
- [x] Zoom
- [x] Layout presets (even / main / tiled) and `next-layout`
- [x] Pane titles, `list-panes --json`, `capture-pane`
- [x] `swap-pane`, `rotate-window`, `display-panes`, `cycle-pane`, `last-pane`
- [x] One command registry shared by buttons, console, `:` line, pane inputs and keys

### Version 0.2.0
- [x] `filter` boxes every match in the pane, with numbered corner marks
- [x] Hover names the matched element in the pane status line
- [x] Live re-query when the page changes under the boxes
- [x] `Esc` / `filter -c` to clear, from the top frame and from inside the pane
- [x] `filter -l` (list only) and `filter -n <max>` (box cap)

### Version 0.3.0
- [x] Pane console: persistent scrollback, toggle button, drag resize, `log` command
- [x] Filter presets (`links internal`, `images large`, …) with `--presets`
- [x] Yes/no confirmation before boxing a preset or a large result
- [x] `Shift+z` zoom toggle (tmux `prefix + Z`)
- [x] Resizable floating debug console

### Version 0.4.0
- [x] `;` command chaining, awaited, from every entry point
- [x] Clickable prompt cards (`api.ask` / `api.askText`) with digit/`y`/`n`/`Esc` parity
- [x] Per-pane `⤢` maximize button synced with `Shift+z`
- [x] Filter refinement rounds (`--in`, `--not-in`, `--text`, `--visible`, `--unique`)
- [x] Filters accumulate across commands (`--replace` to reset)

### Version 0.5.0
- [ ] Floating panes (overlay a pane without taking layout space)
- [ ] `break-pane` / `join-pane`
- [ ] Multiple windows / layout tabs
- [ ] Session persistence (save and restore layouts, titles, URLs)
- [ ] Broadcasting input to all panes
- [ ] Pane drag-and-drop reordering
- [ ] Touch/pointer-based resizing

### Future
- [ ] Firefox compatibility
- [ ] Custom themes
- [ ] Plugin system
- [ ] Cloud sync (optional)

---

## 🤝 Contributing

Contributions welcome! Areas where help is needed:

1. **Testing** - Try it on different sites, report issues
2. **Commands** - Create useful commands ([guide](docs/ADDING_COMMANDS.md))
3. **Documentation** - Improve guides and tutorials
4. **Design** - UI/UX enhancements
5. **Code** - Bug fixes and new features

---

## 📜 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- **TMUX** - The original terminal multiplexer that inspired this project
- **Chrome Extensions** - For the powerful browser APIs
- **Community** - For feedback and feature requests

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/dtrhnet/BMUX/issues)
- **Discussions**: [GitHub Discussions](https://github.com/dtrhnet/BMUX/discussions)

---

**Made with ❤️ for productivity enthusiasts who miss TMUX when browsing**

Version 0.4.0 | Last Updated: November 2026
