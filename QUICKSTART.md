# BMUX Quick Reference

**Version 0.0.1**

## Activation
```
Alt+Shift+B    - Toggle Control Mode (recommended)
Extension Icon - Manual toggle via popup
```

## Control Mode Keys (after Alt+Shift+B)
```
%       - Split horizontal
"       - Split vertical (Shift+')
c       - New window
d       - Detach (hide overlay)
x       - Kill pane (not implemented: says so)
Arrow   - Move focus left / right / up / down (wraps at the edge)
:       - Command prompt
Esc     - Exit Control Mode
```

## Legacy Mode (TMUX-style)
```
Ctrl+b, then %      - Split horizontal
Ctrl+b, then "      - Split vertical
Ctrl+b, then c      - New window
Ctrl+b, then d      - Detach
Ctrl+b, then Arrow  - Move focus
```

## Toolbar Buttons
```
Split H / Split V   - Split the active pane
New Window          - Reset the overlay to one pane
Detach              - Hide / show the overlay
Up / Down /         - Move focus between panes, wrapping at the edge
Left / Right
```

## Focusing Panes
```
Click a pane           - Makes it active (blue border)
Up/Down/Left/Right     - Toolbar buttons, or arrow keys in Control Mode
> focus-pane right     - Same thing from any command input
> focus-pane 2         - By number (reading order, 1..n)
> focus-pane %2        - By id (assigned once, never reused)
> list-panes           - Show every pane: number, id, active marker, URL
```
With two panes side by side and focus on the right one, `Right` lands on the left
pane. Every pane footer shows its own `[number id]` badge, e.g. `[2 %2]`.

## Pane Commands (type in green > prompt)
```
> help              - List all commands
> source            - View HTML source in pane
> restore           - Exit console view
> filter div        - Find all divs
> url               - Show current URL
> url google.com    - Navigate to URL
> reload            - Reload this pane
> clear             - Clear output
```

## Overlay Commands (work from any input)
```
> list-panes            - Every pane with number, id, status, URL
> focus-pane <target>   - Focus by number, %id, or up|down|left|right
> split-window -h|-v    - Split the active pane
> new-window            - Reset to one pane
> detach                - Hide / show the overlay
> control-mode on|off   - Enter or leave Control Mode
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
- **The status bar** shows the focused pane, e.g. `pane 2 %2`
- **Each move logs its result** in the debug console, e.g.
  `Focus right: pane 1/2 (wrapped)`
- **Control Mode** prevents typing on page (good for GitHub, etc.)
- **Debug console** shows all commands but can be dragged away
- **Per-pane input** is local to that specific pane
- **`source` command** converts pane to terminal view
- **CSP removal** lets you load any site (GitHub, Google, etc.)

## Troubleshooting
1. **Extension not working?** Reload extension + refresh page
2. **Can't type?** Exit Control Mode with Esc
3. **Keys do nothing?** Check the status bar: `[CONTROL MODE]` means BMUX owns
   the keyboard; `[NORMAL]` means the page does
4. **Site won't load?** CSP headers should be removed automatically
5. **Commands not working?** Check if in correct input (> vs $)
6. **Focus won't move?** `list-panes` first: one pane cannot move focus, and a
   single-pane layout says "Only one pane: split first"

## Documentation
- Full docs in: `docs/` folder
- README.md: Complete feature list
- docs/COMMAND_USAGE.md: Every command and entry point
- ADDING_COMMANDS.md: Create custom commands
- CSP_HANDLING.md: How iframe blocking works

---

**Pro Tip**: Use `Alt+Shift+B` to quickly enter/exit Control Mode for rapid pane management!
