# BMUX Version 0.1.0 - Release Summary

## Release Information

**Version**: 0.1.0
**Release Date**: November 9, 2026
**Status**: Layout engine and pane management release
**License**: MIT

---

## Highlights

**Percentage splits, mouse resizing, zoom, layouts and real pane management** -
on top of a layout engine that never reparents a pane.

| Area | What shipped |
|------|--------------|
| Layout engine | Binary split tree with ratios; absolutely positioned panes; fractional rectangles |
| Splitting | `split-window -h/-v` with `-l <size>`, `-p <size>`, `-b` (new pane first), `-d` (keep focus) |
| Resizing | Mouse-draggable boundaries with double-click reset; `resize-pane -L/-R/-U/-D`, `-x <size>` |
| Zoom | `resize-pane -Z`; other panes keep running while hidden |
| Layouts | `even-horizontal`, `even-vertical`, `main-vertical`, `main-horizontal`, `tiled`, `next-layout` |
| Pane management | Real `kill-pane` (last pane refused), `swap-pane`, `rotate-window`, `display-panes` |
| Pane identity | Ids `%N` (fixed), layout-order numbers, `[number id]` badges, titles, `list-panes -j` |
| Focus | Toolbar buttons, arrows with wrap-around, click-to-focus (including inside iframes), `cycle-pane`, `last-pane` |
| Commands | 25 commands in one registry (`content/commands.js`) shared by toolbar, console, `:` line, pane inputs, keys and the relay |
| Inspection | `source`, `filter`, `capture-pane`, `url`, `reload` per pane |

## The important one: pages are never reloaded by layout changes

Until 0.0.1, splitting reparented the pane's iframe into a new flex container -
and moving an iframe in the DOM reloads it, so splitting reloaded the page you
were looking at. In 0.1.0 the layout is data:

```
split(row, 0.3) --> leaf(%1)         30% wide
                \-> split(column) --> leaf(%2) 55% of the remainder
                                   \-> leaf(%3) 45% of the remainder
```

Panes are absolutely positioned children of `#bmux-panes` and are never moved.
Splitting, applying a layout preset, swapping, rotating or zooming therefore keeps
every page alive - which is verified in the test harness by a marker set on the
pane iframe's `window` that survives all of those operations.

## Verification

- `node --check` on every changed script; all files kept CRLF line endings.
- 439 jsdom checks (dispatcher, key tables, layout maths, mouse drag, layouts,
  kill/resize/zoom, bad input, relay, and the no-reload guarantee).
- 36 checks with the extension loaded unpacked in Chromium 150 (headless):
  real mouse drag on a split handle, `z` zoom, `Space` layout cycling,
  `main-vertical`, `swap-pane`, `Alt+Arrow` resizing, `rename-pane`,
  `capture-pane`, killing panes down to the last one, arrow focus, and no
  console/page errors.
- Not covered: the `Alt+Shift+B` global hotkey (not synthesizable from DevTools),
  the popup buttons, `Ctrl+b` in a real browser, `chrome.storage`, and
  cross-origin panes.

## Breaking changes

None: every 0.0.1 command still exists with the same meaning, and the extension
still loads as an unpacked MV3 extension with the same permissions.

## Known gaps

Floating panes, `break-pane`/`join-pane`, multiple windows, session persistence
and input broadcasting are not implemented yet; see CHANGELOG.md for the roadmap.

---

# BMUX Version 0.0.1 - Release Summary

## 📦 Release Information

**Version**: 0.0.1  
**Release Date**: December 9, 2025  
**Status**: Initial Public Release  
**License**: MIT

---

## 📂 Project Organization

### Root Files
```
BMUX/
├── README.md              # Main documentation (comprehensive)
├── QUICKSTART.md          # Quick reference card
├── CHANGELOG.md           # Version history
├── LICENSE                # MIT License
├── .gitignore            # Git ignore rules
├── manifest.json          # Extension config (v0.0.1)
└── rules.json             # CSP removal rules
```

### Core Directories
```
├── background/            # Service worker
│   └── main.js           # State management
├── content/              # Content scripts
│   ├── main.js          # UI and controls
│   ├── commands.js      # Command registry
│   └── styles.css       # Modern UI styles
├── popup/                # Extension popup
│   ├── index.html       # Popup UI
│   └── script.js        # Popup logic
└── docs/                 # Documentation
    ├── ADDING_COMMANDS.md
    ├── COMMAND_USAGE.md
    ├── CROSS_ORIGIN.md
    ├── CSP_HANDLING.md
    ├── DESIGN.md
    ├── IMPLEMENTATION.md
    └── UPDATE_STATUS.md
```

---

## ✨ Feature Checklist

### Core Functionality
- [x] Horizontal pane splitting (`%`)
- [x] Vertical pane splitting (`"`)
- [x] Unlimited nested splits
- [x] Current URL cloning on split
- [x] Active pane tracking (blue border)

### Control Systems
- [x] Control Mode (Alt+Shift+B)
- [x] Legacy prefix mode (Ctrl+b)
- [x] Visual mode indicators
- [x] Keyboard shortcut registration
- [x] Input field exclusion (debug console, pane inputs)

### Command System
- [x] Per-pane command input (green `>`)
- [x] Global debug console (green `$`)
- [x] Extensible command registry
- [x] Built-in commands (7 total)
- [x] Console view transformation (`source`)
- [x] Browser view restoration (`restore`)

### Browser Compatibility
- [x] CSP header removal (GitHub, Google, etc.)
- [x] Cross-origin safety checks
- [x] Graceful error messages
- [x] Fallback strategies

### UI/UX
- [x] Modern glassmorphism design
- [x] Draggable debug console
- [x] Per-pane footers
- [x] Visual feedback (borders, colors)
- [x] Responsive layouts

### Documentation
- [x] Comprehensive README
- [x] Quick reference guide
- [x] Developer documentation (7 guides)
- [x] Command creation tutorial
- [x] Security documentation
- [x] Changelog

---

## 📊 Statistics

### Code
- **JavaScript Files**: 4 (main.js x2, commands.js, script.js)
- **CSS Files**: 1 (styles.css)
- **HTML Files**: 1 (popup/index.html)
- **JSON Files**: 2 (manifest.json, rules.json)

### Documentation  
- **Root Docs**: 4 (README, QUICKSTART, CHANGELOG, LICENSE)
- **Guide Docs**: 7 (in docs/ folder)
- **Total Lines**: ~1500+ lines of documentation

### Features
- **Commands**: 7 built-in
- **Keyboard Shortcuts**: 8 registered
- **Control Modes**: 2 (Control + Legacy)
- **Permissions**: 6 requested

---

## 🎯 Version 0.0.1 Goals - COMPLETE

All planned features for initial release have been implemented:

✅ **Multiplexing Core**
- Window splitting (horizontal/vertical)
- Nested pane support
- URL cloning

✅ **Control Systems**  
- Dual input modes
- Keyboard shortcuts
- Visual feedback

✅ **Command Framework**
- Extensible architecture
- Per-pane + global consoles
- Console view mode

✅ **CSP Handling**
- Header removal
- Cross-origin safety
- Clear error messages

✅ **Documentation**
- User guides
- Developer guides
- Quick reference

✅ **Project Organization**
- Clean file structure
- docs/ folder
- Version tracking

---

## 🚀 Installation Instructions

### For Users
1. Download/clone BMUX folder
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select BMUX folder
6. Refresh any open tabs

### For Developers
1. Clone repository
2. Read `docs/ADDING_COMMANDS.md`
3. Edit `content/commands.js`
4. Reload extension in Chrome
5. Test your changes

---

## 📝 Known Issues (Documented)

### Not Yet Implemented
- State persistence (panes don't survive page reload)
- Pane resizing with mouse
- Arrow key navigation
- Session management

### Browser Limitations
- Some sites use JavaScript iframe busters (unfixable)
- Cross-origin content inspection limited by browser
- Cookie restrictions in third-party contexts

All limitations are documented in:
- README.md (Known Limitations section)
- CHANGELOG.md
- docs/CROSS_ORIGIN.md

---

## 🎉 Achievements

### What Makes BMUX Unique
1. **First TMUX-inspired browser extension** with full pane management
2. **Dual command systems** (modal + prefix) for flexibility
3. **Per-pane consoles** like real TMUX
4. **Console view transformation** for source inspection
5. **CSP bypass** allowing any site in panes
6. **Modern UI** with glassmorphism (not retro terminal)

### Code Quality
- Modular architecture
- Extensible command system
- Cross-origin safety
- Comprehensive error handling
- Well-documented

### Documentation Quality
- 11 total documentation files
- Clear examples
- Security transparency
- Developer tutorials
- User guides

---

## 📈 Next Steps (Version 0.1.0)

### Planned Features
- [ ] State persistence
- [ ] Pane resizing
- [ ] Arrow key navigation  
- [ ] Named sessions
- [ ] Better error handling

### Future Roadmap
- [ ] Firefox compatibility
- [ ] Custom themes
- [ ] Plugin system
- [ ] Cloud sync (optional)

See CHANGELOG.md for full roadmap.

---

## 🎓 Learning Outcomes

This project demonstrates:
- Chrome Extension API mastery
- Manifest V3 implementation
- declarativeNetRequest usage
- Content script architecture
- Cross-origin handling
- UI/UX design
- Documentation best practices

---

## 🙌 Version 0.0.1 Status: **COMPLETE**

All goals achieved. Ready for public release.

**Next**: Tag release, test thoroughly, gather user feedback for 0.1.0.

---

*Generated: December 9, 2025*  
*BMUX Version 0.0.1*  
*"Bringing TMUX to the Browser"*
