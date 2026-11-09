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

### Pane footer buttons
Each pane footer carries three small buttons, all of which run the equivalent
command:

| Button | Runs |
|--------|------|
| `▸` / `▾` | `log toggle` — open or close that pane's console |
| `⧉` | `log detach` / `log attach` — float that console in its own window, or dock it |
| `⤢` / `⤡` | `resize-pane -Z` — maximize that pane, or restore the layout |

### Debug console (floating window, `$` prompt)
Runs any command against the **active pane** (blue border) and keeps a scrollback
of every line and result. Drag it by its header, resize it from its corner or bottom
edge — and note it is **hidden by default** now (`debug on|off`), with `verbose on`
mirroring its output into the focused pane instead.

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
Runs any command with **that pane** as the context, and appends the command line
and its result to that pane's console (the scrollback under the input). Overlay
commands work here too — they just act on the whole overlay.

The console opens when a command produces output and stays open: it scrolls,
keeps the last 100 blocks, has a toggle button (`▸` / `▾`) in the footer, and its
top edge can be dragged to resize it (double-click resets, `log size 240` sets it
from the command line).

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
| `z` / `Shift+z` | `resize-pane -Z` (zoom toggle) | same |
| `l` | `log toggle` (this pane's console) | same |
| `keys` | *(command)* list the last key events and their resolution | same |
| `q` | `display-panes` | same |
| `o` | `cycle-pane next` | same |
| `;` | `last-pane` | same |
| `Space` | `next-layout` | same |
| `Esc` | `control-mode off` | — |

Keys pressed while the focus is inside a pane's iframe are resolved in that frame
and relayed to the top frame as a command line (`relay-line` → `execute-line`).

Typing always wins: while a console or pane input has focus, Control Mode passes
keystrokes through to it instead of running bindings.

### Editing the line: history and completion

All three command inputs (a pane's console, the floating debug console and the `:`
line) share one editor:

| Key | Effect |
|-----|--------|
| `Enter` | Run the line (`;` chains are split here) |
| `Up` | Recall the previous command |
| `Down` | Go forward again; past the newest, restore what you were typing |
| `Tab` | Complete the command name, then that command's arguments |
| `Tab` (ambiguous) | Fill in the common prefix; a second `Tab` lists the candidates |

- **History** keeps the last 200 commands, drops consecutive duplicates, and is
  shared by all inputs — run something in a pane, recall it in the floating
  console. It lives in the page (not persisted across reloads).
- **Completion** is command-aware: layout names for `select-layout`, flags for
  `resize-pane` and `split-window`, actions for `log`, `persist`, `inherit`,
  `script`, `control-mode` and `cycle-pane`, directions plus pane ids/numbers for `focus-pane`, presets and
  their variants for `filter`, `--all` for `delete-layout`, and so on.
- Completion works on the segment under the caret, so
  `list-panes; list-p<Tab>` completes the second command.
- Ambiguous candidates are listed in the console (`Completions (5): …`), and a
  token with no candidates reports `No completion for "…"`.

---

## 2. Chaining commands

`;` runs commands one after another. Every entry point understands it — the debug
console, the `:` line, a pane input, and key bindings:

```
> filter img; filter a
> split-window -h; list-panes
> filter -c; filter links --in main
```

- Segments run **awaited**: a prompt raised by one segment is answered before the
  next starts.
- A failing segment does not stop the chain (shell `;` semantics). Each segment is
  echoed on its own line with its own result.
- `\;` is a literal semicolon, and a `;` inside quotes or `[] () {}` does not
  split, so `filter a[href="x;y"]` stays one command and `rename-pane a\;b` keeps
  the semicolon in the title.
- **Filters accumulate across segments**: `filter img; filter a` boxes both sets.
  `--replace` starts a clean set; `filter -c` clears.
- `&&` (stop on error) is not implemented yet; a chain is always “run all”.
- A `.bmux` script line is run through the same dispatcher, so `;` chaining works
  inside a script line exactly as it does here — see [12. Scripts](#12-scripts-bmux-files).

---

## 3. Prompts

When a command needs an answer, it raises a card anchored above the pane's footer.
The card, its choices and its keyboard shortcuts are identical for every command —
`filter` is the first user of the API, and command authors get the same thing via
`api.ask` / `api.askText` (see [ADDING_COMMANDS.md](ADDING_COMMANDS.md)).

```
┌─ 23 links found and labelled. Specify harder constraints? ─┐
│ links (a[href]) · 23 box(es) on screen                     │
│ [ Yes, refine 1 ]   [ No, keep these 2 ]                   │
└────────────────────────────────────────────────────────────┘
```

How to answer:

| Input | Effect |
|-------|--------|
| Click a button | Chooses that option |
| `1` … `9` | Chooses the matching button |
| `Enter` | Takes the primary (highlighted) choice |
| `y` / `n` | Answers a yes/no card |
| `yes` / `no` (typed in any input) | Same as `y` / `n`; maps a missing choice onto the primary button |
| `Esc` | Cancels the prompt |

Rules:

- The card never steals focus from a text field, and keys pressed with the focus
  clicked **inside the pane** work too.
- One prompt per pane; a newer question replaces the older one.
- A prompt is cancelled — never left hanging — when its pane is killed, its iframe
  navigates, the overlay is reset (`new-window`, `detach`), or a newer prompt
  replaces it.
- Yes/no cards time out after 15 seconds (cancelled). Text cards wait
  indefinitely.

---

## 4. Mouse

| Action | Result |
|--------|--------|
| Click a pane body or footer | Focus that pane |
| Click inside a pane's iframe | Focus that pane (works cross-origin, via the window blur/`activeElement` sync) |
| Drag the boundary between two panes | Resize that split |
| Double-click a boundary | Reset that split to 50/50 |
| Hover a boxed match (after `filter`) | Names it in that pane's status line |
| Drag a pane console's top edge | Resize that console (minimum 40px, max 70% of the pane) |
| Double-click a pane console's edge | Reset its height to 140px |
| Drag the floating console's corner | Resize the floating console |
| Click a pane's `⤢` / `⤡` button | Maximize / restore that pane |

Handles are 8 px wide with a hairline marker and a `col-resize`/`row-resize`
cursor. While dragging, a shield covers the overlay so the pointer cannot slip
onto an iframe (iframes swallow mouse events, which would stall the drag). Every
drag is logged, e.g. `Resize: row ratio 0.33`.

---

## 5. Persistence

The layout of the tab you are in is saved as it changes, and restored the next time
the page loads. There is nothing to type for that; the commands are for the
explicit cases.

### What survives what

| Thing | Survives | Where |
|-------|----------|-------|
| Split tree and ratios, pane URLs, custom titles, focus, maximize, console open/height | page reload, in-page navigation | `chrome.storage.session` (`layout:tab:<tabId>`) |
| Named layouts (`save-layout`) | browser restart, extension update | `chrome.storage.local` |
| Prompts, filter boxes, focus history, console scrollback | nothing (transient UI) | — |

Restoring **recreates the panes**, so each page loads fresh: scroll position, form
input and in-page JavaScript state cannot be carried over.

### `debug [on|off|toggle]`
The floating debug window is optional and starts hidden. `debug on` shows it (drag
its header to move, its corner to resize); `debug off` hides it. The preference is
saved with the layout.

### `verbose [on|off|status]`
Mirrors everything BMUX logs — command traces, key handling, filter steps — into
the **focused pane's console**, so you can watch BMUX work without the debug window
on screen. `verbose status` reports the current mode.

### `info [all|layout|panes|keys|state]`
Prints verbose diagnostics: the layout tree with its ratios, every pane with its
size and console/zoom state, the recent key log, and the runtime state (theme,
verbose, debug window, auto-restore and where the layout came from, filters,
prompts, history length).

```
> info layout
== layout ==
split row ratio 0.30
  leaf %1 https://example.com/docs
  split column ratio 0.55
    leaf %2 https://example.com/
    leaf %3 https://example.com/blog
```

### `theme [frost|classic]`
`frost` (default) uses cold blues and ice text; `classic` is the original black
background with green text. Bare `theme` reports the active palette. The choice is
stored with the layout.

### `keys`
Prints the last twelve key events: the raw `key`, the `code`, the modifiers, the
mode they were read in, and the command each resolved to. Use it when a shortcut
does not fire — an unbound key also logs `Unbound key: … (code …) with Shift`.

```
> keys
Recent keys (newest last):
1. Ctrl+b [code KeyB] · prefix → (swallowed, no binding)
2. Shift+% [code Digit5] · prefix → split-window -h
3. F9 [code F9] · control → (swallowed, no binding)
```

### `persist [on|off|status]`
`on` and `off` control the automatic per-tab saving. `off` also clears the current
tab's snapshot (named layouts stay — they were explicit saves). `status` reports
the mode and where the current layout came from (`fresh`, `session`, `named`,
`inherit` or `followed the page`).

A saved layout belongs to the **tab**, so it survives navigation: when the page
underneath changes, the root pane takes the new address and the other panes keep
what they were showing. Reloading restores the layout exactly as it was.

```
> persist status
Auto-restore: on · this layout came from session
> persist off
Auto-restore off: the tab snapshot was cleared and nothing more is written
```

### `inherit [on|off|status]`
Whether a **new tab** starts from the newest layout in the browser. On by default:
a tab with nothing saved adopts another tab's splits, ratios, titles and consoles,
with its own page in the root pane; the other panes keep their addresses. `off`
makes new tabs open with a single pane. The switch also gates offering a snapshot
to other tabs.

```
> inherit status
New tabs inherit the newest layout: on
> inherit off
New tabs now start with a single pane
```

### `save-layout [name]`
Saves the current layout for this site's origin under `name` (default `default`).
Names are single words without `:` — `save-layout work`, not `save-layout my work`.
At most 30 are kept per origin; the oldest is dropped.

```
> save-layout work
Saved layout "work" (2 pane(s)) for https://example.com
```

### `restore-layout <name>`
Applies a saved layout. If the name is unknown it tells you the names that exist.

```
> restore-layout work
Restored layout "work" (2 pane(s))
> restore-layout nope
Error: no layout named "nope". Saved: work
```

### `list-layouts`
Lists this site's saved layouts with pane count and save time.

```
> list-layouts
Saved layouts for https://example.com:
1. work - 2 pane(s) - 2026-11-09 20:37
```

### `delete-layout <name|--all>`
Deletes one layout, or every layout for this site.

### Snapshots are validated
Every snapshot is checked whole before it is stored or applied: version, tree
shape, split ratios inside 1–99%, URL strings, at most 12 panes, depth at most 32,
at most 64 KB. A snapshot that fails is dropped and logged; the overlay renders a
fresh single pane instead of half-applying it.

### Housekeeping
Closing a tab deletes its snapshot, and on browser startup any session layout whose
tab no longer exists is pruned. Where `chrome.storage.session` is unavailable the
tab layer falls back to `chrome.storage.local` with a 6 hour expiry.

---

## 6. Overlay commands

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

### `escape`
What `Esc` runs. It clears filter highlights if any are on screen, otherwise it
leaves Control Mode. It exists as a command so a key pressed inside a pane frame —
which cannot see the top frame's filter state — resolves to the same behaviour.

### `log [toggle|on|off|clear|size <px>|detach|attach]`
Opens, closes, resizes or empties the active pane's console (the scrollback under
its input). `l` in Control Mode is the same as `log toggle`.

```
> log size 240
Console height 240px
> log off
Console closed
```

Heights are clamped to 40px and to 90% of the pane.

`log detach` pulls that pane's console out into its own movables window (drag the
header, resize from the corner or bottom edge); `log attach` — or the `⧉ dock`
button on the window, or the `⧉` button in the pane footer — puts it back. The same
panel is moved, so the scrollback and history come with it, and the detached state
is saved with the layout.

### `sleep <seconds>`
Waits, without freezing anything: the overlay stays live, panes keep loading and
prompts still answer while it waits. Mostly used to pace a `.bmux` script, but it
is an ordinary command, so it chains too.

```
> sleep 2
Slept 2s
> sleep 250ms; list-panes
Slept 250ms
Panes: …
> sleep soon
Error: Sleep takes seconds: "2", "0.5", "250ms" (got "soon")
```

Accepts `2`, `0.5`, `2s`, `250ms`, and no argument means one second. Capped at
3600 s. `script stop` ends a pending pause immediately.

### `script [run|file|demo|open|close|stop|status]`
Runs a `.bmux` script — a list of command lines with `sleep` between them.

| Action | What it does |
|--------|--------------|
| `script run` | run what is in the script panel |
| `script file` | pick a `.bmux` from disk and load it into the panel |
| `script file --run` | load it and start it immediately |
| `script demo` | load the built-in demo and run it |
| `script open` / `script close` | show or hide the panel |
| `script stop` | stop after the current command, or cut a `sleep` short |
| `script status` | panel state, line count, and what the runner is doing |

```
> script demo
Script "demo.bmux": ran 73 command(s)
> script status
Script panel: open · 73 command(s)
Runner: no script running
> script run
Script "demo.bmux": stopped after 12/73
```

Every line is echoed into the debug console as `[7/73] select-layout main-vertical`
with its result, so a run leaves the same transcript as typing it. One script runs
at a time, a script cannot start another, and a failing line does not stop the rest
(the run ends with a count of the errors). The format, limits and a walkthrough of
the shipped demo are in [SCRIPTS.md](SCRIPTS.md).

### `help`
Lists every command, grouped into overlay commands and pane commands, with each
one's description and usage. Generated from the registry, so it cannot go stale.
Hidden aliases (`y`, `n`) are left out.

---

## 7. Pane commands

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

### `filter <selector> [-n <max>] | filter -l <selector> | filter -c`
Finds elements with a CSS selector and **boxes them inside the pane**, then names
each one in the pane's status line as you pass over it.

```
> filter .card
=== 2 match(es): ".card" ===

[1] DIV#alpha.card "Product card"
[2] DIV.card "Beta card"

Boxed 2 of 2 match(es). Hover one to name it in the pane status line; Esc or "filter -c" clears.
```

What you see:

- One **box per match**: 2px amber outline, a light wash, and 7px corner ticks so
  even a tiny or zero-height element is findable. Each box carries a numbered tab
  matching the list above.
- **Hover a match** and the pane footer's status segment names it:

  ```
  FILTER: .card - DIV#alpha.card "Product card" · 1/2
  ```

  That box turns green. Move off a match and the segment reverts to
  `FILTER: .card · 2 match(es)`.
- The overlay is drawn as sibling elements in the pane's own document, in
  document coordinates: it scrolls with the page, and the page's layout is not
  touched (nothing is wrapped, moved or given attributes).
- A `MutationObserver` re-queries the selector and redraws when the page changes,
  so matches added or removed after the filter was applied appear and disappear.
  Pages that move elements without mutating the DOM (CSS transitions) need the
  filter re-run.

Options:

| Form | Meaning |
|------|---------|
| `filter <selector>` | Box every match (up to 200) |
| `filter <preset> [variant]` | Preset query, e.g. `filter links internal` |
| `filter --presets` | List the preset vocabulary |
| `filter -n <max>` | Cap the boxes, e.g. `filter -n 50 .card` (ceiling 1000) |
| `filter -l <target>` | List matches only, draw nothing |
| `filter -y <target>` | Skip the confirmation prompt |
| `filter -c` / `--clear` | Remove the boxes and the status line |

### Filter presets

A preset word expands into a selector, and a variant can narrow it with a
predicate that CSS cannot express on its own ("internal" means the link resolves
to *this document's* origin, including `#anchor` and `/path`):

```
> filter links              # every a[href]
> filter links internal     # links that stay on this site
> filter links external     # links that leave it
> filter links empty        # links with no text
> filter images large       # img wider than 200px
> filter images noalt       # img with no alt text
> filter images broken      # img that failed to load
> filter text main          # paragraphs inside the main content
> filter tables rows        # every table row
> filter media video        # videos and player embeds
```

| Preset | Selector | Variants |
|--------|----------|----------|
| `links` | `a[href]` | `internal`, `external`, `empty` |
| `images` | `img` | `large`, `noalt`, `broken` |
| `headings` | `h1`…`h6` | — |
| `text` | `p, li, td, th, dd, blockquote` | `main` |
| `inputs` | `input, select, textarea` | — |
| `buttons` | `button, input[type=submit], [role=button]` | — |
| `tables` | `table` | `rows`, `cells` |
| `media` | `img, video, audio, iframe, canvas, picture` | `video` |
| `prices` | `[data-price], .price, .product-price, [itemprop=price], .amount` | — |
| `comments` | `.comment, .comment-body, .reply, [data-comment], #comments li` | — |
| `authors` | `.byline, [rel=author], [itemprop=author], .author` | — |
| `dates` | `time, [datetime], .date, .published` | — |
| `articles` | `article` | `headlines` |
| `forms` | `form` | — |
| `code` | `pre, code` | — |
| `main` | `main, article, #content, .post-content, [role=main]` | — |

`filter --presets` prints the same table from the registry, so it cannot go stale.

### Confirming big or preset queries

A preset, or any filter matching more than 25 elements, asks before drawing:

```
> filter links
=== 2 match(es): links (a[href]) ===

[1] A "internal link"
[2] A "external link"

2 match(es) for links. Box them? Type "yes" / "no" (or press y / n; Esc cancels, "filter -y" skips this prompt).
> yes
Boxed 2 of 2 match(es) for links
```

- `yes` / `no` (typed in any input; `y` / `n` are hidden aliases) answer whatever
  prompt is open, mapping a missing choice onto the card's primary button.
- Clicking, digits, `Enter`, `y` / `n` and `Esc` all work as described in
  [Prompts](#3-prompts).
- Yes/no cards time out after 15 seconds (cancelled; the boxes stay as drawn).
- `filter -y links` skips the questions entirely, for scripts.

### Narrowing the result down

A preset, or a result set larger than 25, **draws and labels first**, then offers
to narrow it:

```
> filter links
… 23 match(es) boxed …
┌─ 23 links found and labelled. Specify harder constraints? ─┐
│ [ Yes, refine 1 ]   [ No, keep these 2 ]                    │
└─────────────────────────────────────────────────────────────┘
```

*Yes, refine* opens the narrowing card:

| Choice | Effect | Flag |
|--------|--------|------|
| Inside a container… | keep matches inside a selector you type | `--in <selector>` |
| Exclude a container… | drop matches inside a selector you type | `--not-in <selector>` |
| Text contains… | keep matches whose text contains a word | `--text <word>` |
| Visible only | drop `display:none` / `visibility:hidden` / `opacity:0` / no-box elements | `--visible` |
| Unique targets | de-duplicate by `href`, `src` or text | `--unique [href\|src\|text]` |
| Keep these | stop refining, leave the boxes | `-y` (skip all questions) |
| Cancel filter | clear the boxes | `filter -c` |

Each step intersects the current set, re-labels the boxes and asks again (at most
6 rounds). The same narrowing works without the questions, which is what to use in
scripts:

```
> filter links --in main --text price --visible --unique href
> filter images --in main --not-in .sidebar
```

### Accumulating filters

Filtering a pane that is already boxed **adds** to the set instead of replacing it,
which is what makes a chain useful:

```
> filter img; filter a        # images and links boxed together
> filter -c; filter a         # start clean, then only links
> filter links --replace       # replace without clearing first
```

Clearing:

- **`Esc`** clears the highlights before anything else consumes Escape — from the
  top frame, from the debug console or a pane input, and with the focus clicked
  inside the pane (a second `Esc` then leaves Control Mode as usual). While a
  prompt is open, `Esc` cancels the prompt instead.
- **`filter -c`** clears them from the command surface.

Same-origin only: a cross-origin pane cannot be measured or written into, so the
command reports which URL blocked it and draws nothing. An invalid selector is
reported instead of throwing.

```
> filter ???
Error: Invalid selector "???"
> filter #nothing
No elements match "#nothing"
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

## 8. Active pane context

The debug console and the `:` line always act on the **active pane**:

- Blue glowing border
- Has the `.active` class
- Shown in the status bar as `pane 2 %2 · 30%x100%`
- Its footer has a per-pane status segment, used by `filter` to name the element
  under the pointer

Ways to change it:

- Click a pane's body or footer, or inside its iframe
- `focus-pane <target>`, the `Up`/`Down`/`Left`/`Right` buttons, or arrow keys
- `display-panes` (`q`) then a digit
- `cycle-pane` / `last-pane` (`o` / `;`)
- Split (the new pane becomes active, unless `-d`)
- Kill the focused pane (focus moves to its neighbour)

---

## 9. Error handling

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

## 10. Workflow examples

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

## 11. Tips

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

## 12. Scripts (`.bmux` files)

A `.bmux` file is commands, one per line, run in order. `sleep` paces it. Nothing
about it is special-cased: every line goes through `runLine`, so arguments, `;`
chaining, prompts and errors behave exactly as they do when you type the same line.

```bmux
#!/usr/bin/env bmux
# comments start with # or //
sleep 1
new-window
split-window -h -l 62%
filter img; filter a          # chaining works inside a line
sleep 2.5
```

| Run it with | Effect |
|-------------|--------|
| `script demo` | the built-in demo (`examples/demo.bmux`), about a minute |
| `script file` | pick a file; it loads into the panel for review |
| `script file --run` | pick a file and start it at once |
| `script run` | run the panel's contents (paste a script and go) |
| the panel's **Run** button / `Ctrl+Enter` | same as `script run` |
| `script stop` / **Stop** | stop after the current line, or cut a `sleep` short |

- **Pacing**: `sleep` accepts `1`, `0.5`, `2s`, `250ms`; no argument is one
  second; anything above 3600 s is refused. A pause is cancellable, so Stop is
  always immediate.
- **One at a time**: a second `script run` while one is running is refused, and a
  script cannot start another (that would make Stop a lie).
- **Limits** — 500 commands, 2000 characters per line, 64 KB per file. A script
  that breaks one is refused whole, with the line number.
- **Errors**: a failing line is logged and the run continues; the summary counts
  them (`ran 40/73, 2 command(s) reported an error`).
- **Not possible**: clicking a prompt (pass `-y` instead), surviving a reload or
  navigation, variables/loops/branches, background execution.

The format reference, the limits, how to write a demo and how to record it are in
**[SCRIPTS.md](SCRIPTS.md)**.

---

## 13. Where commands live

| File | Responsibility |
|------|----------------|
| `content/commands.js` | Every command (`BMUX_COMMANDS`), each with `scope`, `description`, `usage`, `execute(api, args)`, plus `BMUX_KEYBINDINGS` |
| `content/main.js` | Overlay DOM, layout tree and rendering, mouse resizing, focus model, and the dispatcher that parses a line and calls `execute` with `api = { client, pane, log }` |
| `background/main.js` | Message relay, and all layout persistence (session snapshots per tab, named layouts per origin) with validation, pruning and tab-close cleanup |

To add a command, see [`ADDING_COMMANDS.md`](ADDING_COMMANDS.md).
