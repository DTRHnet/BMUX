# BMUX (Browser Multiplexer)

BMUX is a cross-browser extension (Chrome & Firefox) that brings the power of TMUX to your web browser. It allows you to manage multiple web panes within a single browser tab, using familiar keyboard shortcuts.

## Features
- **Split Panes**: Vertically (`Ctrl+b "`) and Horizontally (`Ctrl+b %`).
- **Multiple Windows**: Create virtual windows (`Ctrl+b c`).
- **Command Mode**: Execute commands (`Ctrl+b :`).
- **Session Management**: Persistent state across reloads.
- **Pure WebExtensions**: No external apps required.

## Quick Start (Helper Scripts)

We provide helper scripts to automatically detect your browser and launch it with BMUX loaded.

**Windows:**
1. Right-click `install_bmux.ps1` and select **Run with PowerShell**.
2. Select your browser from the list.

**Linux:**
1. Open a terminal.
2. Run `./install_bmux.sh`.

## Manual Installation

### Chrome / Edge
1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer Mode** (top right).
4. Click **Load Unpacked**.
5. Select the `BMUX` folder.

### Firefox
1. Open `about:debugging`.
2. Click **This Firefox**.
3. Click **Load Temporary Add-on**.
4. Select `manifest.json` from the `BMUX` folder.

## Usage
1. Click the BMUX extension icon or press `Ctrl+Shift+B` to open the popup.
2. Click **Attach Session**.
3. An overlay will appear. Use `Ctrl+b` followed by a key:
   - `%`: Split current pane left/right.
   - `"`: Split current pane top/bottom.
   - `x`: Close current pane.
   - `c`: Create new window.
   - `d`: Detach (hide BMUX).
