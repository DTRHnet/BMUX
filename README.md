# BMUX - Browser Multiplexer

**Version 0.0.1**

A Chrome/Firefox extension inspired by TMUX that transforms your browser into a powerful terminal-style multiplexer. Split your browser window into multiple independent panes, each displaying different web content.

![BMUX Version](https://img.shields.io/badge/version-0.0.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 🚀 Quick Start

### Installation

1. **Clone or Download** this repository
2. **Open Chrome**: Navigate to `chrome://extensions`
3. **Enable Developer Mode** (top-right toggle)
4. **Load Unpacked**: Click and select the `BMUX` folder
5. **Refresh** any open tabs to activate

### Basic Usage

1. **Activate BMUX**: Press `Alt+Shift+B` or click the extension icon
2. **Split Horizontally**: Press `%` (in Control Mode)
3. **Split Vertically**: Press `"` (Shift+')
4. **Exit Control Mode**: Press `Escape`
5. **Hide Overlay**: Press `d` or click "Detach"

---

## ✨ Features

### 🪟 Window Splitting
- **Horizontal splits** (`%`) - Side-by-side panes
- **Vertical splits** (`"`) - Stacked panes
- **Unlimited nesting** - Split panes into more panes
- **Responsive layouts** - Automatic resizing

### 🎮 Dual Control Systems

#### Control Mode (Alt+Shift+B)
- **No prefix needed** - Direct keyboard commands
- **Visual indicator** - Blue border when active
- **Modal editing** - Like Vim's command mode

#### Legacy Mode (Ctrl+b)
- **TMUX-style prefix** - Classic two-key combos
- **Works everywhere** - Including input fields
- **Fallback option** - When hotkeys conflict

### 💻 Per-Pane Console
Every pane has a TMUX-style command input at the bottom:

```
> help              # List all commands
> source            # View HTML source in console
> filter div        # Find all div elements
> url google.com    # Navigate to URL
> reload            # Reload this pane
```

### 🛠️ Extensible Commands
Easy-to-add command system (see [`docs/ADDING_COMMANDS.md`](docs/ADDING_COMMANDS.md)):

```javascript
'mycommand': {
    description: 'What it does',
    usage: 'mycommand <arg>',
    execute: async function(pane, args) {
        // Your code here
        return 'Result message';
    }
}
```

### 🌐 CSP Header Removal
Loads sites that normally block iframes (GitHub, Google, Facebook, etc.)
- Uses Chrome's `declarativeNetRequest` API
- Only affects BMUX panes
- See [`docs/CSP_HANDLING.md`](docs/CSP_HANDLING.md) for details

### 🔒 Cross-Origin Safety
Graceful handling of cross-origin restrictions:
- Safe helper functions
- Clear error messages
- Fallback strategies
- See [`docs/CROSS_ORIGIN.md`](docs/CROSS_ORIGIN.md)

---

## 📋 Commands

### Built-in Commands

| Command | Description | Example |
|---------|-------------|---------|
| `help` | List all commands | `> help` |
| `source` | View HTML source (transforms pane) | `> source` |
| `restore` | Return from console to browser view | `> restore` |
| `filter <selector>` | Find elements by CSS selector | `> filter .btn` |
| `url [new-url]` | Show or change pane URL | `> url github.com` |
| `reload` | Reload the pane | `> reload` |
| `clear` | Clear command output | `> clear` |

### Keyboard Shortcuts

| Key | Action (in Control Mode) |
|-----|-------------------------|
| `Alt+Shift+B` | Toggle Control Mode |
| `%` | Split horizontal |
| `"` | Split vertical (Shift+') |
| `c` | New window |
| `d` | Detach (hide overlay) |
| `:` | Command mode |
| `Esc` | Exit Control Mode |

**Legacy (Ctrl+b prefix)**:
1. Press `Ctrl+b`
2. Release both keys
3. Press command key (`%`, `"`, `c`, etc.)

---

## 📚 Documentation

### User Guides
- **[Command Usage Guide](docs/COMMAND_USAGE.md)** - Detailed command system tutorial
- **[Implementation Overview](docs/IMPLEMENTATION.md)** - Architecture and current features

### Developer Guides  
- **[Adding Commands](docs/ADDING_COMMANDS.md)** - How to create custom commands
- **[Cross-Origin Handling](docs/CROSS_ORIGIN.md)** - Understanding browser restrictions
- **[CSP Handling](docs/CSP_HANDLING.md)** - How iframe blocking is bypassed

### Technical Reference
- **[Design Documentation](docs/DESIGN.md)** - Original design specification
- **[Update Status](docs/UPDATE_STATUS.md)** - Development progress tracker

---

## 🗂️ Project Structure

```
BMUX/
├── manifest.json           # Extension configuration
├── rules.json              # CSP header removal rules
├── background/
│   └── main.js            # Service worker (state management)
├── content/
│   ├── main.js            # Content script (UI & controls)
│   ├── commands.js        # Command registry
│   └── styles.css         # Modern glassmorphism UI
├── popup/
│   ├── index.html         # Extension icon popup
│   └── script.js          # Popup controls
└── docs/                  # Documentation
    ├── ADDING_COMMANDS.md
    ├── COMMAND_USAGE.md
    ├── CROSS_ORIGIN.md
    ├── CSP_HANDLING.md
    ├── DESIGN.md
    ├── IMPLEMENTATION.md
    └── UPDATE_STATUS.md
```

---

## 🎨 Design Philosophy

### Not a Direct TMUX Clone
BMUX is **inspired by** TMUX but adapted for the browser:

- ✅ Familiar keyboard shortcuts
- ✅ Pane splitting and management
- ✅ Command-line interface
- ❌ Not a 1:1 terminal emulator
- ❌ Focuses on browser-specific features

### Modern Browser Experience
- **Glassmorphism UI** - Semi-transparent, blurred backdrop
- **Draggable debug console** - Move it out of the way
- **Per-pane footers** - Local context for each pane
- **Visual feedback** - Blue borders, color indicators

---

## 🔐 Privacy & Security

### What BMUX Does
- ✅ Removes CSP/X-Frame-Options headers for panes
- ✅ Stores state locally in browser
- ✅ Open source - fully auditable code

### What BMUX Does NOT Do
- ❌ Track your browsing
- ❌ Send data over network
- ❌ Inject ads or modify content
- ❌ Access sites you don't explicitly load

### Permissions Explained
- **`declarativeNetRequest`** - Remove iframe-blocking headers
- **`<all_urls>`** - Apply rules to any site you load
- **`tabs`, `storage`** - Manage panes and save state

See [`docs/CSP_HANDLING.md`](docs/CSP_HANDLING.md) for full security details.

---

## 🐛 Known Limitations

### Browser Restrictions
- **Some sites** may use JavaScript iframe busters (can't be bypassed)
- **Cookie restrictions** may affect third-party content
- **Same limitations** as browser DevTools iframes

### Current Version (0.0.1)
- ⏳ State persistence not fully implemented
- ⏳ Pane resizing not yet available
- ⏳ Advanced navigation (arrow keys) coming soon
- ⏳ Session management in development

---

## 🛣️ Roadmap

### Version 0.1.0
- [ ] Full state persistence (save/restore layouts)
- [ ] Pane resizing with mouse
- [ ] Arrow key navigation between panes
- [ ] Named sessions

### Version 0.2.0
- [ ] Background processing in panes
- [ ] Scripted workflows
- [ ] Pane templates
- [ ] Export/import configurations

### Future
- [ ] Firefox compatibility
- [ ] Custom themes
- [ ] Plugin system
- [ ] Cloud sync (optional)

---

## 🤝 Contributing

Contributions welcome! Areas where help is needed:

1. **Testing** - Try it on different sites, report issues
2. **Commands** - Create useful pane commands ([guide](docs/ADDING_COMMANDS.md))
3. **Documentation** - Improve guides and tutorials
4. **Design** - UI/UX enhancements
5. **Code** - Bug fixes and new features

---

## 📜 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- **TMUX** - The original terminal multiplexer that inspired this project
- **Chrome Extensions** - For the powerful browser APIs
- **Community** - For feedback and feature requests

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/BMUX/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/BMUX/discussions)

---

**Made with ❤️ for productivity enthusiasts who miss TMUX when browsing**

Version 0.0.1 | Last Updated: December 2025
