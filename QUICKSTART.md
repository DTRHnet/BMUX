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
:       - Command prompt
Esc     - Exit Control Mode
```

## Legacy Mode (TMUX-style)
```
Ctrl+b, then %     - Split horizontal
Ctrl+b, then "     - Split vertical
Ctrl+b, then c     - New window
Ctrl+b, then d     - Detach
```

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

## Debug Console (floating window)
```
$ help              - Same commands as pane input
$ source            - Affects active pane (blue border)
[Drag the header to move console]
```

## Tips
- **Click a pane** to make it active (blue border)
- **Control Mode** prevents typing on page (good for GitHub, etc.)
- **Debug console** shows all commands but can be dragged away
- **Per-pane input** is local to that specific pane
- **`source` command** converts pane to terminal view
- **CSP removal** lets you load any site (GitHub, Google, etc.)

## Troubleshooting
1. **Extension not working?** Reload extension + refresh page
2. **Can't type?** Exit Control Mode with Esc
3. **Site won't load?** CSP headers should be removed automatically
4. **Commands not working?** Check if in correct input (> vs $)

## Documentation
- Full docs in: `docs/` folder
- README.md: Complete feature list
- ADDING_COMMANDS.md: Create custom commands
- CSP_HANDLING.md: How iframe blocking works

---

**Pro Tip**: Use `Alt+Shift+B` to quickly enter/exit Control Mode for rapid pane management!
