# BMUX Command Usage Guide

## Two Ways to Run Commands

### 1. **Per-Pane Input** (Bottom of each pane)
Located at the bottom of each pane with a green `>` prompt.

**What it affects**: Only that specific pane  
**Commands available**: All commands work here  
**Output location**: Shows in expandable output area below the input

**Example workflow**:
```
> source          # Transforms THIS pane to console view
> restore         # Restores THIS pane back to browser
> filter div      # Filters elements in THIS pane
> url google.com  # Changes THIS pane's URL
```

### 2. **Global Debug Console** (Floating window)
The draggable debug console in the top-right corner.

**What it affects**: The currently active pane (blue border)  
**Commands available**: All commands work here too  
**Output location**: Shows in the debug console itself  

**Example workflow**:
```
$ help           # Shows all commands in debug console
$ source         # Transforms the ACTIVE pane to console view
$ filter div     # Filters elements in the ACTIVE pane
```

## Command Differences

### `source` Command

**Before**: Logged HTML to browser console only  
**Now**: Transforms the pane into a terminal-style console view

**Usage**:
```
> source
```

**What happens**:
1. Iframe is hidden
2. Pane becomes a green-text console showing HTML source
3. Can scroll through the entire source code
4. Syntax highlighting (HTML tags shown as `&lt;` and `&gt;`)

**To return to browser view**:
```
> restore
```

### `help` Command

**Where it works**:
- ✅ Global debug console (shows output in console)
- ✅ Per-pane input (shows output below pane)

**Example in Debug Console**:
```
$ help
> Command help output appears in debug console scrollback
```

**Example in Pane Input**:
```
> help
> Command help appears in pane output area
```

## Complete Command List

### Viewing Commands
- `source` - Transform pane to console showing HTML source
- `filter <selector>` - Show elements matching CSS selector
- `url` - Show current URL
- `restore` - Return from console view to browser view

### Navigation Commands
- `url <new-url>` - Navigate pane to new URL
- `reload` - Reload the pane

### Utility Commands
- `help` - List all available commands
- `clear` - Clear command output

## Console View Mode

When you run `source`, the pane transforms into a console:

**Visual Changes**:
- Black background (`#1a1a1a`)
- Green text (`#0f0`)
- Monospaced font (Consolas/Monaco)
- Scrollable content
- HTML escaped (safe viewing)

**Header shows**:
```
HTML SOURCE (25430 chars)
```

**To exit console view**:
```
> restore
```

**Note**: The iframe is still there (just hidden), so `restore` brings it back instantly.

## Active Pane Context

The **debug console** always operates on the **active pane**:

**Active pane indicators**:
- Blue glowing border
- Has `.active` class
- Most recently clicked/split

**To change active pane**:
- Click inside another pane
- Split (new pane becomes active)

**Debug console behavior**:
```
$ source         # Affects pane with blue border
[Split to new pane - now that's active]
$ url google.com # Affects the NEW pane
```

## Best Practices

### For Quick Commands
Use **per-pane input** when:
- Working with a specific pane
- Want output to stay with that pane
- Don't want to track which pane is active

### For Global Control
Use **debug console** when:
- Want persistent scrollback
- Running multiple commands quickly
- Need to see command history

### Console View Workflow

1. **Inspect source**:
   ```
   > source
   [Scroll through HTML]
   > restore
   ```

2. **Extract specific elements**:
   ```
   > filter .product-name
   [View matching elements]
   > filter img
   [View all images]
   ```

3. **Switch between views**:
   ```
   > source
   [Examine HTML structure]
   > restore
   [Back to browser]
   > filter form input
   [Check form fields]
   ```

## Error Handling

**Cross-origin content**:
```
> source
Error: Cross-origin content
URL: https://github.com/...
```
Nothing breaks - just can't access external site's DOM.

**No active pane (debug console only)**:
```
$ help
Error: No active pane
```
Create a pane first by activating BMUX.

**Unknown command**:
```
> notacommand
Unknown: notacommand. Type "help" for commands.
```

## Tips

1. **Use `help` in debug console** to keep the list visible while you work
2. **Use `source` in a split pane** to compare HTML with rendered view
3. **Use `restore` anytime** - the iframe never truly goes away
4. **Commands are case-sensitive** - use lowercase
5. **Debug console scrolls** - earlier commands stay visible

## Keyboard Shortcuts

**In any pane input or debug console**:
- `Enter` - Execute command
- `Escape` - (In pane input) Does nothing yet
- `Escape` - (In Control Mode) Exits Control Mode

**Remember**:
- Pane inputs: Green `>` prompt
- Debug console: Green `$` prompt
- Both execute the same commands!
