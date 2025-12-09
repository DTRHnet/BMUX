# Changelog

All notable changes to BMUX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2025-12-09

### Initial Release

#### Added
- **Core multiplexing functionality**
  - Horizontal and vertical pane splitting
  - Unlimited nested splits
  - Current page URL cloning on split
  
- **Dual control systems**
  - Control Mode (Alt+Shift+B) with direct key commands
  - Legacy TMUX-style (Ctrl+b) prefix mode
  
- **Per-pane command system**
  - Green `>` prompt at bottom of each pane
  - Extensible command registry in `content/commands.js`
  - Built-in commands: help, source, restore, filter, url, reload, clear
  
- **Global debug console**
  - Draggable floating console
  - Executes commands on active pane
  - Full scrollback history
  
- **Console view mode**
  - `source` command transforms pane to terminal view
  - Displays HTML source with syntax escaping
  - `restore` command returns to browser view
  
- **CSP header removal**
  - Uses declarativeNetRequest API
  - Allows loading GitHub, Google, Facebook, etc. in iframes
  - Only affects BMUX panes (not main page)
  
- **Cross-origin safety**
  - Helper functions for safe iframe access
  - Graceful error messages for restricted content
  - Fallback strategies for URL detection
  
- **Modern UI**
  - Glassmorphism design with backdrop blur
  - Dark theme optimized for readability
  - Visual indicators (blue border for active pane)
  - Responsive layouts
  
- **Documentation**
  - Comprehensive README.md
  - 7 detailed guides in docs/ folder
  - Command development tutorial
  - Security and privacy documentation

#### Technical Details
- Manifest V3 browser extension
- Content scripts with iframe support
- Background service worker for state management
- Declarative net request rules
- Modular command architecture

#### Browser Compatibility
- Chrome/Edge: Full support
- Firefox: Manifest needs minor adjustments (not yet tested)

### Known Limitations
- State persistence not fully implemented (panes don't survive page reload)
- No pane resizing with mouse
- No arrow key navigation
- No session management
- Some sites with JavaScript iframe busters may not work

### Security Notes
- Requires `<all_urls>` permission for CSP removal
- All code is open source and auditable
- No data collection or external requests
- Local storage only

---

## [Unreleased]

### Planned for 0.1.0
- Full state persistence
- Pane resizing
- Arrow key navigation
- Named sessions
- Better error handling

### Future Considerations
- Plugin/extension system
- Custom themes
- Cloud sync (optional)
- Firefox full compatibility
- Performance optimizations
