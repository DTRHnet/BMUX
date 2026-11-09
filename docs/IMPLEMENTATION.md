# BMUX Implementation Summary

## Current Status

BMUX is fully functional with the following features implemented:

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
- All keyboard input is captured by BMUX
- Keys resolve through `BMUX_KEYBINDINGS.control` in `content/commands.js`:
  - `%`: `split-window -h`
  - `"`: `split-window -v` (Shift+')
  - `c`: `new-window`
  - `d`: `detach` (hide overlay)
  - `x`: `kill-pane` (registered; reports "not implemented")
  - `:`: `command-prompt` (opens the `:` line)
  - `←` `→` `↑` `↓`: `focus-pane left|right|up|down`
  - `Esc`: `control-mode off`

### 4. **Pane Focus Model**
- The active pane is the one element carrying the `active` class (blue border).
- Focus is never implied by creation order. It is set explicitly by:
  - `setActivePane(pane)` from a split, a click, `focus-pane`, or a key binding.
  - A click on the pane body or footer (`mousedown` on the pane).
  - A click inside a pane's iframe: the main window blurs with the iframe as
    `document.activeElement`, which is the only cross-origin-safe signal.
- Directional movement reads real pane rectangles (`getBoundingClientRect`):
  the nearest pane whose centre lies in that direction wins, with a penalty for
  drifting off-axis. When nothing lies that way, focus wraps to the pane furthest
  on the opposite side. Layout is nested flexbox, so this works for 2 panes, 2×2
  grids and asymmetric splits without assuming a grid shape.
- Every move logs its result, e.g. `Focus right: pane 1/2 (wrapped)`.

### 5. **Pane Identity**
- **Ids**: `%1`, `%2`, … assigned once when a pane is created (`data-pane-id`) and
  never reused, so they survive renumbering.
- **Numbers**: reading-order position, 1..n, recomputed on every refresh so they
  always run 1..n after a split or new window.
- **Badge**: every pane footer shows `[number id]`, e.g. `[2 %2]`.
- `list-panes` prints number, id, active marker and URL for every pane;
  `focus-pane` accepts a number, an id, or a direction.

### 6. **Command Registry**
- `content/commands.js` defines every command (overlay and pane) with
  `scope`, `description`, `usage` and `execute(api, args)`.
- It also holds `BMUX_KEYBINDINGS`, which maps Control Mode and `Ctrl+b` keys to
  command lines.
- `content/main.js` contains no command definitions, no help text and no
  key-to-action switch. It parses a line and calls `execute` with
  `api = { client, pane, log }`.
- One dispatcher serves the toolbar, the debug console, the `:` line, each pane's
  input, both key tables and the background relay.
- Command lookup uses own-property checks, so `constructor`, `__proto__` and
  friends report `Unknown command`.

### 7. **Modern UI Design**
- **Glassmorphism**: Semi-transparent backdrop with blur effect
- **Draggable Debug Console**:
  - Floating window with green terminal-style text
  - Drag using the header bar
  - Runs any command, with scrollback
- **Toolbar**:
  - Window actions on the left (`Split H`, `Split V`, `New Window`, `Detach`)
  - Directional focus buttons (`Up`, `Down`, `Left`, `Right`) pushed to the right
- **Per-Pane Footer**:
  - Command input for that pane
  - `[number id]` badge
  - Output area for command results
- **Status bar**: `[CONTROL MODE]`/`[NORMAL]` on the left, focused pane
  (`pane 2 %2`) on the right

### 8. **Splitting System**
- Uses flexbox for dynamic, responsive layouts
- Supports nested splits (unlimited depth)
- Each split creates independent iframes
- The new pane becomes active and receives the next id
- Known limitation: reparenting an iframe in the DOM reloads it, so splitting
  reloads the page in the pane that was split

## How to Use

### Installation
1. Load the extension in Chrome/Firefox:
   - Chrome: `chrome://extensions` → Enable Developer Mode → Load Unpacked
   - Firefox: `about:debugging` → Load Temporary Add-on
2. Navigate to the BMUX folder and select it

### Basic Workflow
1. **Activate BMUX**:
   - Click the extension icon → "Show/Hide Overlay"
   - OR press `Alt+Shift+B` (enters Control Mode)

2. **Split Windows**:
   - **Method 1**: Click toolbar buttons "Split H" or "Split V"
   - **Method 2**: Enter Control Mode (`Alt+Shift+B`), then press `%` or `"`
   - **Method 3**: `split-window -h` / `-v` in the console

3. **Navigate**:
   - Use the `Up` / `Down` / `Left` / `Right` toolbar buttons
   - Press an arrow key in Control Mode (or after `Ctrl+b`)
   - Click a pane, or inside its iframe
   - `focus-pane 2`, `focus-pane %2`, `focus-pane right`
   - `list-panes` shows every pane and which one is active

4. **Exit**:
   - Press `d` in Control Mode, or
   - Click "Detach" button, or
   - Click extension icon → "Show/Hide Overlay"

## Architecture

### File Structure
```
BMUX/
├── manifest.json          # Extension configuration
├── background/
│   └── main.js           # Service worker (global state & message relay)
├── content/
│   ├── main.js           # Client script (overlay DOM, layout, focus, dispatcher)
│   ├── commands.js       # Command registry + key bindings (source of truth)
│   └── styles.css        # Modern glassmorphism styles
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
1. User presses `%`, `:` or an arrow key in Control Mode →
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

## Future Enhancements

1. **State Persistence**:
   - Save split layouts
   - Restore sessions on browser restart

2. **Pane Management**:
   - `kill-pane` that actually closes a pane
   - Pane resizing with the mouse
   - Tab cycling between panes
   - Zoom the focused pane

3. **Splitting Improvements**:
   - Split without reloading the iframe being split (build the new pane from the
     URL instead of reparenting the existing one)

4. **Advanced Commands**:
   - Resize panes
   - Rename panes
   - Scripted layout commands

5. **Background Processing**:
   - Run scripts in panes while browsing normally
   - Auto-split on specific URLs
   - Scripted workflows (e.g., "split vertical, load site A in left, site B in right")

## Known Issues

1. **First Load**: If extension doesn't activate, reload the page once after installing
2. **Iframe Sandbox**: Some sites block iframes (e.g., Google, Facebook)
3. **Hotkey Conflicts**: If `Alt+Shift+B` is taken, change in `chrome://extensions/shortcuts`
4. **Splitting reloads the split pane**: moving an iframe in the DOM reloads it
5. **`new-window` discards the layout**: it resets the overlay to one pane
6. **`kill-pane` is not implemented**: it reports so instead of acting
7. **Cross-origin panes** cannot be inspected (`source`, `filter`), only their URL
   is available

## Troubleshooting

### "Extension doesn't work"
1. Reload extension in `chrome://extensions`
2. Refresh the web page
3. Open browser console (F12) and check for errors
4. Verify content script loaded: Look for "BMUX Client Loading..." in console

### "Keyboard shortcuts don't work"
1. Check if Control Mode is active (blue border, `[CONTROL MODE]` in the status bar)
2. Verify hotkey isn't conflicting: `chrome://extensions/shortcuts`
3. Use toolbar buttons as fallback
4. Use popup buttons to manually trigger actions

### "Focus won't move"
1. `list-panes` — if there is one pane, split first (`split-window -h`)
2. Watch the debug console: each move logs `Focus <dir>: pane N/M` or an error
3. If a pane has no geometry (hidden overlay), open the overlay and try again

### "Splits aren't rendering"
1. Open Debug Console (should auto-appear)
2. Check for `Split horizontal` / `Split vertical` log messages
3. Use browser DevTools to inspect `#bmux-panes` element

## Credits

Inspired by TMUX terminal multiplexer.
Built as a cross-browser extension for modern web development workflows.
