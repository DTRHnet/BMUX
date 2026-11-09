# BMUX - Browser Multiplexer

**Version 0.0.1**

A Chrome/Firefox extension inspired by TMUX that transforms your browser into a powerful terminal-style multiplexer. Split your browser window into multiple independent panes, each displaying different web content.

![BMUX Version](https://img.shields.io/badge/version-0.0.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

> **Unreleased on this branch:** directional pane focus (toolbar buttons, arrow keys,
> wrap-around, click-to-focus), pane numbers and ids with `list-panes` / `focus-pane`,
> and a single command registry that the toolbar, console, `:` line, pane inputs and
> keys all share. See [CHANGELOG.md](CHANGELOG.md).

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
4. **Move focus**: Click a pane, use the `Up` / `Down` / `Left` / `Right` toolbar
   buttons, or press an arrow key in Control Mode
5. **Exit Control Mode**: Press `Escape`
6. **Hide Overlay**: Press `d` or click "Detach"

---

## ✨ Features

### 🪟 Window Splitting
- **Horizontal splits** (`%`) - Side-by-side panes
- **Vertical splits** (`"`) - Stacked panes
- **Unlimited nesting** - Split panes into more panes
- **Responsive layouts** - Automatic resizing

### 🎯 Pane Navigation
- **Four toolbar buttons** - `Up`, `Down`, `Left`, `Right` at the right end of the
  toolbar. Each one runs `focus-pane <direction>` through the same dispatcher as
  the console.
- **Arrow keys** - In Control Mode, or after the `Ctrl+b` prefix.
- **Wrap-around** - With two panes side by side and focus on the right pane,
  `Right` moves to the left pane. No dead ends at the edge of a layout.
- **Geometric** - The nearest pane in that direction wins, with a penalty for
  drifting off-axis, so the pane straight ahead beats a nearer one off to the side.
- **Click to focus** - Clicking a pane's body, its footer, or inside its iframe
  makes it the active pane (blue border).
- **Every move is logged** - e.g. `Focus right: pane 1/2 (wrapped)` in the debug
  console, so you can see what the focus model did.

### 🏷️ Pane Identity
- **Numbers** - Each pane's reading-order position (`1`, `2`, …), recomputed after
  a split so numbers always run 1..n.
- **Ids** - `%1`, `%2`, … assigned once when a pane is created and never reused.
- **Badge** - Every pane footer shows `[number id]`, e.g. `[2 %2]`.
- **`list-panes`** - Lists number, id, active marker and URL for every pane.

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
> focus-pane 1      # Focus the pane numbered 1
```

### 🛠️ Extensible Commands
One registry defines every command — overlay and pane alike — in
`content/commands.js` (see [`docs/ADDING_COMMANDS.md`](docs/ADDING_COMMANDS.md)):

```javascript
'mycommand': {
    scope: 'pane',                      // 'overlay' or 'pane'
    description: 'What it does',
    usage: 'mycommand <arg>',
    execute: async function(api, args) {
        const pane = api.pane;          // api = { client, pane, log }
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
- See [`docs/CROSS_ORIGIN.md`](docs/CROSS_ORIGIN.md) for details

---

## 📋 Commands

Commands can be run from the toolbar, the debug console (`$` prompt), the `:`
line in Control Mode, or a pane's input (`>` prompt). One dispatcher runs them all:
`content/main.js` parses the line, looks it up in `content/commands.js` and calls
the command with an `api` object. Nothing about commands lives anywhere else.

### Overlay Commands

These act on the whole overlay.

| Command | Description | Example |
|---------|-------------|---------|
| `help` | List every command, grouped by scope | `> help` |
| `list-panes` | Number, id, active marker and URL for each pane | `> list-panes` |
| `focus-pane <n\|%id\|dir>` | Focus a pane by number, id, or direction (`up`/`down`/`left`/`right`, wraps) | `> focus-pane %2` |
| `split-window [-h\|-v]` | Split the active pane (default `-h`) | `> split-window -v` |
| `new-window` | Reset the overlay to one pane | `> new-window` |
| `detach` | Hide or show the overlay | `> detach` |
| `kill-pane` | Not implemented: reports that no pane was killed | `> kill-pane` |
| `control-mode [on\|off\|toggle]` | Turn Control Mode on, off, or toggle it | `> control-mode on` |
| `command-prompt` | Open the `:` command line | `> command-prompt` |

### Pane Commands

These act on one pane — the pane whose input you typed into, or the active pane
for the console and `:` line.

| Command | Description | Example |
|---------|-------------|---------|
| `source` | View HTML source (transforms pane) | `> source` |
| `restore` | Return from console to browser view | `> restore` |
| `filter <selector>` | Find elements by CSS selector | `> filter .btn` |
| `url [new-url]` | Show or change pane URL | `> url github.com` |
| `reload` | Reload the pane | `> reload` |
| `clear` | Clear command output | `> clear` |

Bad input never throws: an unknown command, an unknown pane, a missing argument or
an unknown flag returns a message and leaves focus where it was. `constructor`,
`__proto__` and similar names are rejected as unknown commands.

### Keyboard Shortcuts

| Key | Action in Control Mode |
|-----|------------------------|
| `Alt+Shift+B` | Toggle Control Mode |
| `%` | Split horizontal |
| `"` | Split vertical (Shift+') |
| `c` | New window |
| `d` | Detach (hide overlay) |
| `x` | Kill pane (not implemented: reports it) |
| `←` `→` `↑` `↓` | Move focus left / right / up / down, with wrap-around |
| `:` | Command mode |
| `Esc` | Exit Control Mode |

**Legacy (Ctrl+b prefix)** — the same commands, after `Ctrl+b`:

1. Press `Ctrl+b`
2. Release both keys
3. Press command key (`%`, `"`, `c`, `d`, `x`, `:` or an arrow key)

Both key tables live in `BMUX_KEYBINDINGS` in `content/commands.js`; each entry is
a command line, so keys are not a second code path.

---

## 📚 Documentation

### User Guides
- **[Command Usage Guide](docs/COMMAND_USAGE.md)** - Entry points, commands, pane numbers and ids
- **[Implementation Overview](docs/IMPLEMENTATION.md)** - Architecture and current features

### Developer Guides
- **[Adding Commands](docs/ADDING_COMMANDS.md)** - How to create custom commands
- **[Cross-Origin Handling](docs/CROSS_ORIGIN.md)** - Understanding browser restrictions
- **[CSP Handling](docs/CSP_HANDLING.md)** - How iframe blocking is bypassed

### Technical Reference
- **[Design Documentation](docs/DESIGN.md)** - Original design specification (historical)
- **[Update Status](docs/UPDATE_STATUS.md)** - Development progress tracker (historical)

---

## 🗂️ Project Structure

```
BMUX/
├── manifest.json           # Extension configuration
├── rules.json              # CSP header removal rules
├── background/
│   └── main.js            # Service worker (state, message relay)
├── content/
│   ├── main.js            # Content script (overlay, layout, focus, dispatcher)
│   ├── commands.js        # Command registry + key bindings (source of truth)
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

`content/commands.js` is the single source of truth for commands. `content/main.js`
owns the DOM and the pane layout, and holds no command definitions, help text or
key-to-action switch.

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
- **Per-pane footers** - Local context for each pane, with a `[number id]` badge
- **Visual feedback** - Blue borders, colour indicators, focus logs

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

### Current Version (0.0.1 + unreleased changes)
- ⏳ State persistence not fully implemented
- ⏳ Pane resizing not yet available
- ⏳ `kill-pane` is registered but reports "not implemented"
- ⏳ `new-window` resets the layout to a single pane
- ⏳ Splitting reloads the iframe of the pane being split (moving an iframe in
  the DOM reloads it)
- ⏳ Session management in development

---

## 🛣️ Roadmap

### Version 0.1.0
- [ ] Full state persistence (save/restore layouts)
- [ ] Pane resizing with mouse
- [x] Directional focus: toolbar buttons, arrow keys, wrap-around, click-to-focus
- [x] Pane numbers and ids, `list-panes` / `focus-pane`
- [x] One command registry shared by buttons, console, `:` line, pane inputs and keys
- [ ] `kill-pane` actually closing a pane
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
2. **Commands** - Create useful commands ([guide](docs/ADDING_COMMANDS.md))
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

- **Issues**: [GitHub Issues](https://github.com/dtrhnet/BMUX/issues)
- **Discussions**: [GitHub Discussions](https://github.com/dtrhnet/BMUX/discussions)

---

**Made with ❤️ for productivity enthusiasts who miss TMUX when browsing**

Version 0.0.1 | Last Updated: November 2026
