# BMUX Quick Reference

**Version 0.5.0**

## Activation
```
Alt+Shift+B    - Turn BMUX on (overlay + Control Mode, blue border); again to turn it off
Extension Icon - The same: one click activates, another hides
```

## Control Mode Keys (after Alt+Shift+B)
```
%            - Split horizontal (also Shift+5, 5)
"            - Split vertical (also Shift+', ')
c            - New window
d            - Detach (hide overlay)
x            - Kill pane (last pane is refused)
Arrow        - Move focus left / right / up / down (wraps at the edge)
Alt+Arrow    - Resize: move the boundary 2%
z / Shift+z  - Zoom the focused pane (toggle; tmux prefix + Z)
l            - Open/close this pane's console
q            - Show pane numbers; press a digit to jump
o / ;        - Cycle to the next pane / back to the previous one
Space        - Next layout preset
:            - Command prompt
Esc          - Clear filter boxes; if none, exit Control Mode
               (display-panes numbers cancel first)
```

## Legacy Mode (TMUX-style)
```
Ctrl+b, then %            - Split horizontal
Ctrl+b, then "            - Split vertical
Ctrl+b, then c            - New window
Ctrl+b, then d            - Detach
Ctrl+b, then x            - Kill pane
Ctrl+b, then Arrow        - Move focus
Ctrl+b, then Alt+Arrow    - Resize
Ctrl+b, then z / q / o / ; / Space - Zoom / numbers / cycle / last / layout
```

## Persistence (layouts survive a reload)
```
Automatic         - Splits, ratios, URLs, titles, focus, zoom and consoles are
                    saved per tab and restored when the page loads again
> save-layout work        - Save this layout for the site (survives restarts)
> restore-layout work     - Bring it back
> list-layouts            - What is saved for this site
> delete-layout work      - Remove it (or --all)
> persist off             - Stop saving this tab and clear its snapshot
> persist status          - On/off, and where the current layout came from
```
Restoring recreates the panes, so the pages load fresh (scroll position is not
kept). `persist off` is the privacy switch; nothing is ever synced.

## Chaining commands
```
> filter img; filter a          - Run both, one after another
> split-window -h; list-panes   - Any commands, from any input
> esc \; key                    - \; is a literal semicolon
```
A failing command doesn't stop the chain; a prompt raised by one is answered
before the next starts.

## Prompts (click, key or command)
```
[ Yes, refine 1 ]  [ No, keep these 2 ]   - Click, or press the digit
Enter                                     - Take the highlighted/primary choice
y / n                                     - Answer a yes/no prompt
yes / no                                  - Type the answer instead
Esc                                       - Cancel the prompt
```

## Palette and debug output
```
> theme frost        - Default: cold blues, ice text
> theme classic      - The old black/green terminal look
> debug on|off       - Show/hide the floating debug window (hidden by default)
> verbose on         - Mirror debug output into the focused pane console
> info               - Layout tree, panes, recent keys, runtime state
```

## Detaching a pane console
```
⧉ button in the footer / > log detach   - Pull the console into its own window
Drag its header                        - Move it
Drag its corner or bottom edge         - Resize it
⧉ dock button / > log attach           - Put it back in the pane
```

## If a shortcut does not fire
```
> keys          - Last 12 key events: raw key, code, modifiers, and what they ran
```
`Ctrl+b` works in every mode, including inside Control Mode. `Alt+Shift+B` can be
stolen by the window manager — rebind it at `chrome://extensions/shortcuts`.

## Command line editing (every input)
```
Up / Down       - Recall previous commands (Down past the newest restores your draft)
Tab             - Complete the command name, then its arguments
Tab Tab         - List the candidates in the console
```
Ctrl+b keys still apply: this is the input's own editing, in the pane console, the
floating console and the `:` line, which all share one history.

## Enlarging the console
```
Drag the two-line grip on the console's top edge - up to 90% of the pane
Double-click the grip                          - Back to 140px
> log size 320                                 - Set it exactly
```
The floating console resizes from its bottom-right corner or its bottom edge.

## Maximize a pane
```
⤢ button in the pane footer  - Maximize that pane (same as Ctrl+b, Shift+z)
⤡ button                     - Restore the layout
z / Shift+z                  - The same, from the keyboard
```

## Toolbar Buttons
```
Split H / Split V   - Split the active pane
New Window          - Reset the overlay to one pane
Detach              - Hide / show the overlay
Up / Down /         - Move focus between panes, wrapping at the edge
Left / Right
Zoom                - Zoom the focused pane
Layout              - Cycle layout presets
```

## Mouse
```
Click a pane / its iframe   - Focus it (blue border)
Drag a boundary             - Resize the split
Double-click a boundary     - Reset that split to 50/50
Hover a boxed match         - Names it in that pane's status line
```

## Pane console
```
Run any command             - Opens the console and appends to the scrollback
Click the footer toggle     - Open/close it (also: l, or > log toggle)
Drag its top edge           - Resize (double-click resets; > log size 240)
> clear                     - Empty the scrollback
```
It stays open with a scrollbar; it no longer auto-collapses after a few seconds.

## Filter highlighting
```
> filter .card              - Box every match in this pane, numbered
> filter img; filter a      - Box two kinds of match at once (they accumulate)
> filter links internal     - Preset words: links that stay on this site
> filter images large       - images wider than 200px
> filter --presets          - List every preset and variant
> filter -n 50 .card        - Cap the boxes (default 200)
> filter -l a               - List matches only, draw nothing
> filter -c                 - Remove the boxes
> filter -y links           - Draw without asking
> filter links --in main --text price --visible --unique href
> filter -c                 - Clear the boxes (--replace resets a filter set)
```
Presets and results over 25 elements draw first, then offer to narrow down:
*Inside a container*, *Exclude a container*, *Text contains*, *Visible only*,
*Unique targets*, *Keep these*, *Cancel* — all clickable.
Each box has an outline plus corner ticks so tiny elements are findable. Hovering
one writes `FILTER: .card - DIV.card "Product" · 3/12` into the pane's footer
status line and turns that box green. Same-origin panes only.

## Focusing Panes
```
Click a pane           - Makes it active (blue border)
Up/Down/Left/Right     - Toolbar buttons, or arrow keys in Control Mode
q then a digit         - display-panes: numbers over the panes
> focus-pane right     - Same thing from any command input
> focus-pane 2         - By number (layout order, 1..n)
> focus-pane %2        - By id (assigned once, never reused)
> last-pane / o        - Back to the previous pane / next pane
> list-panes           - Number, id, size, marker, title, URL
```
With two panes side by side and focus on the right one, `Right` lands on the left
pane. Every pane footer shows its own `[number id]` badge, e.g. `[2 %2]`.

## Splitting
```
> split-window -h            - Beside the active pane (50/50)
> split-window -v            - Below the active pane
> split-window -h -l 30%     - New pane gets 30% (also accepts 30 or 0.3)
> split-window -h -b         - Put the new pane first (left/top)
> split-window -h -d         - Keep focus on the pane being split
```

## Resizing and Zooming
```
Drag a boundary                 - Mouse resize
Double-click a boundary         - Back to 50/50
> resize-pane -R 10             - Move the boundary right by 10%
> resize-pane -x 25%            - Make the pane 25% of its parent split
> resize-pane -Z                - Zoom / unzoom the focused pane
```

## Layouts
```
> select-layout even-horizontal - Equal columns
> select-layout even-vertical   - Equal rows
> select-layout main-vertical   - Wide main pane on the left, rest stacked
> select-layout main-horizontal - Tall main pane on top, rest side by side
> select-layout tiled           - Grid
> next-layout                   - Cycle (Space in Control Mode)
```
Changing layout never reloads the pages in the panes.

## Reordering
```
> swap-pane 1 2        - Two panes trade places
> swap-pane %3         - Swap the active pane with the pane %3
> rotate-window        - Every pane moves one slot (also --reverse)
```

## Pane Commands (type in green > prompt)
```
> help              - List all commands
> source            - View HTML source in pane
> restore           - Exit console view
> filter div        - Box every div, name each on hover
> filter -c         - Clear the boxes
> capture-pane      - Print the pane's visible text
> rename-pane Docs  - Title shown in the footer ("-" clears it)
> url               - Show current URL
> url google.com    - Navigate to URL
> reload            - Reload this pane
> clear             - Clear output
```

## Overlay Commands (work from any input)
```
> list-panes [-j]        - Every pane; -j for JSON
> focus-pane <target>    - Focus by number, %id, or up|down|left|right
> split-window ...       - Split the active pane
> kill-pane [target]     - Close a pane (the last one is refused)
> resize-pane ...        - -L/-R/-U/-D, -x <size>, -Z
> select-layout <name>   - even-horizontal|even-vertical|main-vertical|
                           main-horizontal|tiled
> new-window             - Reset to one pane
> detach                 - Hide / show the overlay
```

## Debug Console (floating window)
```
$ help              - Same commands as pane input
$ list-panes        - Every pane, numbered and identified
$ source            - Affects active pane (blue border)
[Drag the header to move console]
```

## Tips
- **Click a pane** to make it active (blue border)
- **The status bar** shows the focused pane and its size, e.g.
  `pane 2 %2 · 30%x100%`, plus `· ZOOM` while zoomed
- **Each move logs its result** in the debug console, e.g.
  `Focus right: pane 1/2 (wrapped)`
- **Control Mode** prevents typing on page (good for GitHub, etc.)
- **Numbers move, ids do not**: after a split, numbers are renumbered but `%N`
  ids stay with their pane, so scripts should use ids
- **`filter` draws over the page, never into it**: boxes are sibling overlays in
  the pane document, so the page's own layout is untouched
- **`source` command** converts pane to terminal view
- **CSP removal** lets you load any site (GitHub, Google, etc.)

## Troubleshooting
1. **Extension not working?** Reload extension + refresh page
2. **Can't type?** Exit Control Mode with Esc
3. **Keys do nothing?** Check the status bar: `[CONTROL MODE]` means BMUX owns
   the keyboard; `[NORMAL]` means the page does. A focused console/pane input
   always receives typing, even in Control Mode.
4. **Site won't load?** CSP headers should be removed automatically
5. **Commands not working?** Check if in correct input (> vs $)
6. **Focus won't move?** `list-panes` first: one pane cannot move focus, and a
   single-pane layout says "Only one pane: split first"
7. **Can't resize?** `resize-pane -U/-D` needs a stacked split, `-L/-R` needs a
   side-by-side one; the message says which is missing

## Documentation
- Full docs in: `docs/` folder
- README.md: Complete feature list
- docs/COMMAND_USAGE.md: Every command and entry point
- ADDING_COMMANDS.md: Create custom commands
- CSP_HANDLING.md: How iframe blocking works

---

**Pro Tip**: Drag a boundary while you work — mouse resizing is the thing a terminal TMUX cannot give you.
