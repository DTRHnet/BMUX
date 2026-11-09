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

### Debug console (floating window, `$` prompt)
Runs any command against the **active pane** (blue border) and keeps a scrollback
of every line and result. Drag it by its header.

```
$ list-panes
$ split-window -h
```

### `:` command line (Control Mode)
Press `:` in Control Mode and type a command. Same dispatcher, same commands.
`Enter` runs it, `Esc` closes the line and leaves Control Mode on.

```
: split-window -v
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
| `Esc` | `control-mode off` | — |

Keys pressed while the focus is inside a pane's iframe are resolved in that frame
and relayed to the top frame as a command line (`relay-line` → `execute-line`).

---

## 2. Overlay commands

Overlay commands manage the whole overlay. They work with or without a pane.

### `list-panes`
Prints every pane: number, id, active marker, URL.

```
$ list-panes
Panes:
1 %1            https://example.com/
2 %2   [ACTIVE] https://example.com/docs
```

- **Number** – reading-order position, 1..n. Recomputed after a split, so it can
  change.
- **Id** – `%1`, `%2`, … assigned once when the pane is created and never reused.

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

Bad targets are reported, never thrown, and leave focus where it was:

```
$ focus-pane 99
Error: No pane "99". Type "list-panes" to see the panes.
$ focus-pane
Error: Usage: focus-pane <number|%id|up|down|left|right>
```

### `split-window [-h|-v]`
Splits the active pane. `-h` (the default) puts the new pane beside it, `-v` below
it. The new pane becomes active and gets the next id.

### `new-window`
Resets the overlay to a single pane showing the current page. This discards the
current layout.

### `detach`
Hides or shows the overlay. Reports `Detached` or `Attached`.

### `kill-pane`
Registered but **not implemented**: it reports that no pane was killed. The `x`
key binding says the same instead of doing nothing silently.

### `control-mode [on|off|toggle]`
Turns Control Mode on, off, or toggles it. Escape in Control Mode is this command
with `off`.

### `command-prompt`
Opens the `:` command line. Bound to `:` in both key tables.

### `help`
Lists every command, grouped into overlay commands and pane commands, with each
one's description and usage. Generated from the registry, so it cannot go stale.

---

## 3. Pane commands

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
elements to the browser console.

```
> filter .product-name
=== Found 3 element(s): ".product-name" ===

[0] SPAN.product-name
...
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

## 4. Active pane context

The debug console and the `:` line always act on the **active pane**:

- Blue glowing border
- Has the `.active` class
- Shown in the status bar as `pane 2 %2`

Ways to change it:

- Click a pane's body or footer
- Click inside a pane's iframe (works cross-origin, via the window blur sync)
- `focus-pane <target>`, the `Up`/`Down`/`Left`/`Right` buttons, or arrow keys
- Split (the new pane becomes active)

```
$ source          # affects the pane with the blue border
[split - the new pane is now active]
$ url google.com  # affects the new pane
```

---

## 5. Error handling

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
$ help
```
Overlay commands work with no pane. Pane commands report it:
```
Error: No pane to show
```

**Command failed internally**
```
Error: <message from the command>
```

---

## 6. Workflow examples

### Diagnose "which pane has focus?"

```
$ list-panes
Panes:
1 %1            https://example.com/
2 %2   [ACTIVE] https://example.com/docs
$ focus-pane left
Focus left: pane 1/2
$ list-panes
Panes:
1 %1   [ACTIVE] https://example.com/
2 %2            https://example.com/docs
```

### Three-way layout by command

```
$ split-window -h     # 2 panes
$ split-window -v     # 3 panes, new one below
$ focus-pane left     # to the tall pane
$ split-window -h     # 4 panes
$ list-panes          # check numbers and ids
```

### Inspect a page, then get back

```
> filter form input
> source
[scroll through HTML]
> restore
```

### Compare an element across two panes

```
> filter .price        # in the left pane's input
> focus-pane 2
> filter .price        # now in the right pane
```

---

## 7. Tips

1. **`list-panes` first** whenever focus surprises you: it shows both what the
   panes are and which one is active.
2. **Numbers move, ids do not.** After a split, numbers are renumbered but `%N`
   ids stay with their pane, so scripts should use ids.
3. **Every move is logged** in the debug console, e.g.
   `Focus right: pane 1/2 (wrapped)`.
4. **Use `help` in the console** to keep the command list visible while you work.
5. **Commands are case-sensitive** — use lowercase.
6. **`Escape`** closes the `:` line; a second `Escape` leaves Control Mode.

---

## 8. Where commands live

| File | Responsibility |
|------|----------------|
| `content/commands.js` | Every command (`BMUX_COMMANDS`), each with `scope`, `description`, `usage`, `execute(api, args)`, plus `BMUX_KEYBINDINGS` |
| `content/main.js` | Overlay DOM, pane layout, focus model, and the dispatcher that parses a line and calls `execute` with `api = { client, pane, log }` |
| `background/main.js` | State and message relay; forwards a command line from a pane frame to the top frame |

To add a command, see [`ADDING_COMMANDS.md`](ADDING_COMMANDS.md).
