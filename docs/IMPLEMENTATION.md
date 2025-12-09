# BMUX Implementation Summary

## Current Status

BMUX is now fully functional with the following features implemented:

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
- Direct key commands (no Ctrl+b prefix needed):
  - `%`: Split window horizontally
  - `"`: Split window vertically (Shift+')
  - `c`: Create new window
  - `d`: Detach (hide overlay)
  - `Esc`: Exit Control Mode

### 4. **Modern UI Design**
- **Glassmorphism**: Semi-transparent backdrop with blur effect
- **Draggable Debug Console**: 
  - Floating window with green terminal-style text
  - Drag using the header bar
  - Input field for sending commands to panes
- **Per-Pane Footer**:
  - Each split pane has a small footer
  - "Console" button to focus debug console for that pane
  - Displays unique Pane ID
- **Clean Toolbar**: Minimal header with hover effects
- **Soft Rounded Corners**: Modern card-style panes

### 5. **Splitting System**
- Uses flexbox for dynamic, responsive layouts
- Supports nested splits (unlimited depth)
- Each split creates independent iframes
- Active pane shows blue glow border

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

3. **Navigate**:
   - Use mouse to click inside any iframe pane
   - Per-pane console button allows debugging/scripting that specific pane

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
│   ├── main.js           # Client script (UI & key handling)
│   └── styles.css        # Modern glassmorphism styles
└── popup/
    ├── index.html        # Extension icon popup
    └── script.js         # Popup button handlers
```

### Message Flow
1. **Popup Button Click** → 
2. `popup/script.js` sends message to `content/main.js` →
3. Content script toggles overlay or control mode

**For Keyboard Shortcuts:**
1. **User presses `Alt+Shift+B`** →
2. Browser triggers `toggle-bmux-mode` command →
3. `background/main.js` receives command →
4. Sends `toggle-control-mode` message to active tab →
5. `content/main.js` updates UI and enters command mode

**For In-Mode Commands:**
1. **User presses `%` in Control Mode** →
2. `content/main.js` detects key →
3. Sends `relay-to-top` to background →
4. Background sends `execute-key` back to top frame →
5. Top frame executes `splitWindow('horizontal')`

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

1. **Per-Pane Console**: 
   - Each pane gets its own isolated console
   - Can inject scripts into specific panes
   - Extract form data, scrape content, etc.

2. **State Persistence**:
   - Save split layouts
   - Restore sessions on browser restart

3. **Pane Navigation**:
   - Arrow keys to switch between panes
   - Tab cycling

4. **Advanced Commands**:
   - Resize panes
   - Rename panes
   - Kill specific panes
   - Zoom pane (full screen)

5. **Background Processing**:
   - Run scripts in panes while browsing normally
   - Auto-split on specific URLs
   - Scripted workflows (e.g., "split vertical, load site A in left, site B in right")

## Known Issues

1. **First Load**: If extension doesn't activate, reload the page once after installing
2. **Iframe Sandbox**: Some sites block iframes (e.g., Google, Facebook)
3. **Hotkey Conflicts**: If `Alt+Shift+B` is taken, change in `chrome://extensions/shortcuts`

## Troubleshooting

### "Extension doesn't work"
1. Reload extension in `chrome://extensions`
2. Refresh the web page
3. Open browser console (F12) and check for errors
4. Verify content script loaded: Look for "BMUX Client Loading..." in console

### "Keyboard shortcuts don't work"
1. Check if Control Mode is active (blue border)
2. Verify hotkey isn't conflicting: `chrome://extensions/shortcuts`
3. Use toolbar buttons as fallback
4. Use popup buttons to manually trigger actions

### "Splits aren't rendering"
1. Open Debug Console (should auto-appear)
2. Check for "Split Horizontal" or "Split Vertical" log messages
3. Use browser DevTools to inspect `#bmux-panes` element

## Credits

Inspired by TMUX terminal multiplexer.
Built as a cross-browser extension for modern web development workflows.
