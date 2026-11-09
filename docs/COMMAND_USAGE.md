# BMUX Command Usage Guide

Every command in BMUX is defined once, in `content/commands.js`. The toolbar, the
debug console, the `:` line, each pane's input and the key bindings all run those
same commands through one dispatcher, so a command behaves identically wherever
you type it.

```
command line ──► content/main.js runCommand() ──► BMUX_COMMANDS[name].execute(api, args)
```

---

## 1. Entry points

### Toolbar buttons
Each button runs the command it is named after and logs both the line and its
result in the debug console:

| Button | Runs |
|--------|------|
| `Split H` | `split-window -h` |
| `Split V` | `split-window -v` |
| `New Window` | `new-window` |
| `Detach` | `detach` |
| `Up` | `focus-pane up` |
| `Down` | `focus-pane down` |
| `Left` | `focus-pane left` |
| `Right` | `focus-pane right` |
| `Zoom` | `resize-pane -Z` |
| `Layout` | `next-layout` |

### Debug console (floating window, `$` prompt)
Runs any command against the **active pane** (blue border) and keeps a scrollback
of every line and result. Drag it by its header.

```
$ list-panes
$ split-window -h -l 30%
```

### `:` command line (Control Mode)
Press `:` in Control Mode and type a command. Same dispatcher, same commands.
`Enter` runs it, `Esc` closes the line and leaves Control Mode on.

```
: select-layout main-vertical
```

### Per-pane input (`>` prompt, bottom of each pane)
Runs any command with **that pane** as the context, and shows the result in that
pane's output area. Overlay commands work here too — they just act on the whole
overlay.

```
> source
> url example.com
> focus-pane 2
```

### Keys
Control Mode and the `Ctrl+b` prefix map keys to command lines through
`BMUX_KEYBINDINGS` in `content/commands.js`:

| Key | Control Mode | After `Ctrl+b` |
|-----|--------------|----------------|
| `%` | `split-window -h` | same |
| `"` | `split-window -v` | same |
| `c` | `new-window` | same |
| `x` | `kill-pane` | same |
| `d` | `detach` | same |
| `:` | `command-prompt` | same |
| `←` `→` `↑` `↓` | `focus-pane left/right/up/down` | same |
| `Alt+←` `Alt+→` `Alt+↑` `Alt+↓` | `resize-pane -L/-R/-U/-D 2` | same |
| `z` | `resize-pane -Z` | same |
| `q` | `display-panes` | same |
| `o` | `cycle-pane next` | same |
| `;` | `last-pane` | same |
| `Space` | `next-layout` | same |
| `Esc` | `control-mode off` | — |

Keys pressed while the focus is inside a pane's iframe are resolved in that frame
and relayed to the top frame as a command line (`relay-line` → `execute-line`).

Typing always wins: while a console or pane input has focus, Control Mode passes
keystrokes through to it instead of running bindings.

---

## 2. Mouse

| Action | Result |
|--------|--------|
| Click a pane body or footer | Focus that pane |
| Click inside a pane's iframe | Focus that pane (works cross-origin, via the window blur/`activeElement` sync) |
| Drag the boundary between two panes | Resize that split |
| Double-click a boundary | Reset that split to 50/50 |

Handles are 8 px wide with a hairline marker and a `col-resize`/`row-resize`
cursor. While dragging, a shield covers the overlay so the pointer cannot slip
onto an iframe (iframes swallow mouse events, which would stall the drag). Every
drag is logged, e.g. `Resize: row ratio 0.33`.

---

## 3. Overlay commands

Overlay commands manage the whole overlay. They work with or without a pane.

### `list-panes [-j|--json]`
Prints every pane: number, id, size, active/zoom marker, title and URL.

```
$ list-panes
Panes:
1 %1   50%x100%   [ACTIVE] Docs - https://example.com/docs
2 %2   50%x100%            GitHub - https://github.com/
```

- **Number** – layout order, top-to-bottom and left-to-right, 1..n. Recomputed
  after every structural change, so it can change.
- **Id** – `%1`, `%2`, … assigned once when the pane is created and never reused.
- **Size** – the pane's share of the overlay (width x height).
- **Marker** – `[ACTIVE]`, `[ZOOM]`, or blank.

`-j` prints the same data as JSON with fractional geometry, for scripts:

```
$ list-panes -j
[
  { "number": 1, "id": "%1", "title": "Docs", "active": true, "zoomed": false,
    "size": { "x": 0, "y": 0, "w": 0.5, "h": 1 }, "url": "https://example.com/docs" }
]
```

### `focus-pane <number|%id|up|down|left|right>`
Focuses a pane, and that pane gets the blue border and the `[ACTIVE]` marker.

```
$ focus-pane 2        # by number
$ focus-pane %2       # by id (same pane)
$ focus-pane right    # move focus one pane right
```

Directional moves are geometric and **wrap**: the target is the nearest pane whose
centre lies in that direction, with a penalty for drifting off-axis. When nothing
lies that way, focus moves to the pane furthest on the opposite side.

With two panes side by side and focus on the right one:

```
$ focus-pane right
Focus right: pane 1/2 (wrapped)
```

Wrapping examples:

| Layout | From | Command | Result |
|--------|------|---------|--------|
| two panes, side by side | right pane | `focus-pane right` | left pane |
| two panes, stacked | bottom pane | `focus-pane down` | top pane |
| 2×2 grid | bottom-right | `focus-pane down` | top-right |
| single pane | — | any direction | `Error: Only one pane: split first` |

### `last-pane` / `cycle-pane [next|prev]`
`last-pane` returns to the pane that was active before; `cycle-pane` walks panes
in layout order and wraps.

### `split-window [-h|-v] [-l <size>] [-b] [-d]`
Splits the active pane. The new pane clones the active pane's URL.

| Flag | Meaning |
|------|---------|
| `-h` / `horizontal` | New pane beside (default) |
| `-v` / `vertical` | New pane below |
| `-l <size>` / `-p <size>` | Size of the new pane: `30%`, `30` or `0.3` (10–90%) |
| `-b` | New pane goes first (left/top) |
| `-d` | Keep focus on the pane being split |

```
$ split-window -h -l 30%
Split horizontal: 30/70
```

The pane being split is **not** reloaded: the layout tree changes, the iframe
stays put.

### `kill-pane [number|%id]`
Closes a pane and gives its space to its neighbour. Focus moves to the survivor.

```
$ kill-pane 2
Killed pane 2 (%2). Focus is on pane 1 (%1).
$ kill-pane
Error: Cannot kill the last pane
```

### `resize-pane [-L|-R|-U|-D <percent>] [-x <size>] [-Z]`
Moves the split boundary next to the pane in the pressed direction, sets the
pane's share, or toggles zoom.

```
$ resize-pane -R 10      # move the boundary right by 10% of the overlay
$ resize-pane -U 5       # ... up by 5% (needs a stacked split)
$ resize-pane -x 25%     # the pane now takes 25% of its parent split
$ resize-pane -Z         # zoom / unzoom
```

Boundaries are clamped to 5–95%. If the layout has no split on that axis, the
command says so (`No stacked split to resize`).

### `select-layout <name>` / `next-layout`
Rebuilds the layout from the same panes. **No page is reloaded.**

| Name | Result |
|------|--------|
| `even-horizontal` | Equal columns |
| `even-vertical` | Equal rows |
| `main-vertical` | First pane 60% wide on the left, the rest stacked |
| `main-horizontal` | First pane 60% tall on top, the rest side by side |
| `tiled` | Grid, `ceil(sqrt(n))` columns |

`next-layout` cycles: even-horizontal → main-vertical → even-vertical →
main-horizontal → tiled.

### `swap-pane <a> [b]` / `rotate-window [-r|--reverse]`
Reorders panes without touching the DOM, so every page keeps running.
`swap-pane` with one target swaps it with the active pane; `rotate-window` moves
every pane one slot along the layout (forwards: each pane moves to the next slot).

### `display-panes`
Shows each pane's number over it for two seconds. Press a digit to focus that
pane; `Escape` cancels.

### `new-window`
Resets the overlay to a single pane showing the current page. This discards the
current layout (and reloads that one page, because the pane is new).

### `detach`
Hides or shows the overlay. Reports `Detached` or `Attached`.

### `control-mode [on|off|toggle]`
Turns Control Mode on, off, or toggles it. `Escape` in Control Mode is this
command with `off`.

### `command-prompt`
Opens the `:` command line. Bound to `:` in both key tables.

### `help`
Lists every command, grouped into overlay commands and pane commands, with each
one's description and usage. Generated from the registry, so it cannot go stale.

---

## 4. Pane commands

Pane commands act on one pane: the pane whose input you typed into, or the active
pane when run from the console or the `:` line.

### `source`
Transforms that pane into a terminal-style console view of the page's HTML.

```
> source
Console view active. Use 'restore' to return.
```

The iframe is hidden, not removed, so `restore` brings it straight back. The view
shows `HTML SOURCE (25430 chars)` as a header. Cross-origin content cannot be read:

```
> source
Error: Cross-origin content
URL: https://github.com/...
```

### `restore`
Returns the pane from the console view to the browser view.
`Already in browser view` if it was not in console view.

### `filter <selector>`
Lists elements matching a CSS selector (same-origin only), also logging the
elements to the browser console. An invalid selector returns an error instead of
throwing.

```
> filter .product-name
=== Found 3 element(s): ".product-name" ===

[0] SPAN.product-name
```

### `capture-pane [-n <lines>]`
Prints the pane's visible text (same-origin only), last `n` lines first — default
40.

```
> capture-pane -n 3
=== Docs (3/48 lines) ===

Installation
Run the extension
Open a page
```

### `rename-pane <title|->`
Sets the title shown in the pane footer. `-` clears it back to the automatic
title (page `<title>` when same-origin, otherwise the URL).

```
> rename-pane Docs
Pane 1 is now "Docs"
> rename-pane -
Title cleared: pane 1 shows "example.com/docs"
```

### `url [new-url]`
Shows the pane's URL, or navigates it.

```
> url
Current URL: https://example.com/
> url https://example.org
Navigating to: https://example.org
```

### `reload`
Reloads the pane. Cross-origin panes are reloaded by reassigning `src`.

### `clear`
Clears the pane's output area and prints nothing.

---

## 5. Active pane context

The debug console and the `:` line always act on the **active pane**:

- Blue glowing border
- Has the `.active` class
- Shown in the status bar as `pane 2 %2 · 30%x100%`

Ways to change it:

- Click a pane's body or footer, or inside its iframe
- `focus-pane <target>`, the `Up`/`Down`/`Left`/`Right` buttons, or arrow keys
- `display-panes` (`q`) then a digit
- `cycle-pane` / `last-pane` (`o` / `;`)
- Split (the new pane becomes active, unless `-d`)
- Kill the focused pane (focus moves to its neighbour)

---

## 6. Error handling

The dispatcher never throws at you; every failure comes back as text.

**Unknown command**
```
> notacommand
Error: Unknown command "notacommand". Type "help" for commands.
```
Names that exist only on `Object.prototype` are rejected the same way, so
`constructor`, `__proto__` and `hasOwnProperty` are unknown commands, not commands.

**No pane**
```
> capture-pane
Error: No pane to capture
```

**Bad arguments** — reported, and the layout and focus are left alone:
```
> focus-pane 99
Error: No pane "99". Type "list-panes" to see the panes.
> split-window -l 5%
Error: Size must be between 10% and 90%
> resize-pane -U 5      (in a side-by-side layout)
Error: No stacked split to resize (the layout has no horizontal boundary)
```

**Command failed internally**
```
Error: <message from the command>
```

---

## 7. Workflow examples

### Sidebar layout by command

```
$ split-window -h -l 30%        # 30% sidebar on the left
$ rename-pane Docs              # title it
$ focus-pane 2                  # into the main pane
$ url https://github.com        # load something else there
$ list-panes                    # check numbers, sizes, titles
```

### Diagnose "which pane has focus?"

```
$ list-panes
Panes:
1 %1   50%x100%   [ACTIVE] Docs - https://example.com/docs
2 %2   50%x100%            GitHub - https://github.com/
$ focus-pane left
Focus left: pane 1/2
$ list-panes
Panes:
1 %1   50%x100%            Docs - https://example.com/docs
2 %2   50%x100%   [ACTIVE] GitHub - https://github.com/
```

### Four-pane workspace

```
$ split-window -h
$ split-window -v
$ focus-pane 1
$ split-window -v
$ select-layout tiled        # 2x2 grid, nothing reloaded
$ rename-pane Notes
```

### Compare two pages side by side

```
$ split-window -h -l 50%
$ focus-pane 2
$ url https://example.org
$ focus-pane 1
$ url https://example.com
$ swap-pane 1 2              # if you want the other order
```

### Read a pane without leaving the keyboard

```
$ focus-pane 2
$ capture-pane -n 20         # last 20 lines of visible text
$ source                     # or browse the HTML
$ restore
```

### Zoom while you read, then get the layout back

```
$ resize-pane -Z             # focused pane fills the overlay
$ ...read...
$ resize-pane -Z             # layout restored, all pages still loaded
```

---

## 8. Tips

1. **`list-panes` first** whenever focus or sizes surprise you.
2. **Numbers move, ids do not.** Numbers follow the layout; `%N` ids stay with
   their pane, so scripts should use ids.
3. **Everything that reorders the layout keeps your pages alive** — split,
   `select-layout`, `swap-pane`, `rotate-window`, zoom. Only `new-window` (and
   `reload`) reload.
4. **Drag boundaries** instead of typing sizes when you are already using the
   mouse; double-click resets a split to 50/50.
5. **Every move is logged** in the debug console, e.g.
   `Focus right: pane 1/2 (wrapped)` or `Resize: row ratio 0.33`.
6. **Commands are case-sensitive** — use lowercase.
7. **`Escape`** closes the `:` line; a second `Escape` leaves Control Mode.

---

## 9. Where commands live

| File | Responsibility |
|------|----------------|
| `content/commands.js` | Every command (`BMUX_COMMANDS`), each with `scope`, `description`, `usage`, `execute(api, args)`, plus `BMUX_KEYBINDINGS` |
| `content/main.js` | Overlay DOM, layout tree and rendering, mouse resizing, focus model, and the dispatcher that parses a line and calls `execute` with `api = { client, pane, log }` |
| `background/main.js` | State and message relay; forwards a command line from a pane frame to the top frame |

To add a command, see [`ADDING_COMMANDS.md`](ADDING_COMMANDS.md).
