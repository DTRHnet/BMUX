# BMUX Version 0.5.0 - Release Summary

## Release Information

**Version**: 0.5.0
**Release Date**: November 9, 2026
**Status**: Layout persistence release
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Reload survival | Splits, ratios, pane URLs, titles, focus, maximize and console state are saved per tab and restored on load |
| Storage | `storage.session` per tab (reload-safe, dies with the browser) + `storage.local` for explicit named layouts; never `sync` |
| Commands | `persist [on\|off\|status]`, `save-layout`, `restore-layout`, `list-layouts`, `delete-layout` |
| Safety | Snapshots validated whole (version, shape, ratios, ≤ 12 panes, ≤ 32 deep, ≤ 64 KB); bad ones ignored, never half-applied |
| Housekeeping | Tab-close cleanup, startup pruning, 6 h fallback where `storage.session` is missing |
| Cleanup | The dead session `STATE` machinery and the "State Fetched" stub are gone; `unlimitedStorage` dropped |
| Line editing | `Up`/`Down` history and `Tab` completion in the pane console, the floating console and the `:` line — one shared history, command-aware arguments |

## The shape of it

The content script never touches storage. It asks the background, which knows the
tab id and owns the keys:

```
               persist-save {snapshot}                     storage.session
content ─────────────────────────────► background ─────────────────────► layout:tab:<tabId>
        ◄─────────────────────────────            │
               persist-load {enabled, snapshot}     └───► storage.local
                                                          layout:named:<origin>:<name>
                                                          persist:enabled
```

**Writes** are debounced from every structural change (400 ms) plus an immediate
save when the tab is hidden or unloaded. **Reads** happen before the first pane is
drawn, so a restore never flashes an empty overlay, with an 800 ms ceiling if the
service worker is cold.

## What does not come back

Restoring **recreates** the panes, so the pages load fresh: scroll position, form
input and in-page JavaScript state cannot be carried across a reload. Prompts,
filter boxes, focus history and console scrollback are not persisted either (the
console's open state and height are).

## Verification

- 644 jsdom checks — with the real `background/main.js` running as a second window
  against in-memory `storage.session` / `storage.local`, so the shipped persistence
  path is exercised end to end: round trip, reload via a fresh content script,
  named layouts, the off switch, corrupt/junk/unsupported/malformed snapshots,
  caps, tab-close cleanup, startup pruning, exit saves and debounce coalescing.
- 87 Chromium checks — including a real `page.reload()` restoring a 30/70 split
  with a custom title and the maximize state, pages loading fresh afterwards,
  `save-layout` → `new-window` → `restore-layout`, and `persist off` → reload →
  one pane.
- Not verified: an actual browser restart (the harness cannot restart Chromium),
  the `storage.session` fallback path on a browser that lacks it, and touch input.

---

# BMUX Version 0.4.0 - Release Summary

## Release Information

**Version**: 0.4.0
**Release Date**: November 9, 2026
**Status**: Chaining, clickable prompts, and filter refinement
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Chaining | `;` runs commands in sequence from every entry point, awaited, errors do not stop the chain |
| Prompts | `api.ask` / `api.askText` render a clickable card (buttons, digits, `Enter`, `y`/`n`, `Esc`, `yes`/`no`) |
| Maximize | Every pane footer has a `⤢` / `⤡` button, the on-screen form of `Ctrl+b`, `Shift+z` |
| Filter refinement | Draw and label first, then *Inside a container*, *Exclude*, *Text contains*, *Visible only*, *Unique targets*, *Keep these*, *Cancel* |
| Filter accumulation | `filter img; filter a` boxes both (`--replace` for a clean set) |

## The workflow this enables

```
> filter links
23 match(es) boxed and labelled
[ Yes, refine ]  [ No, keep these ]
> (click Yes)
Narrow them down how?   [ Inside a container ] [ Text contains ] [ Visible only ] [ Unique targets ] [ Keep these ] [ Cancel ]
> (click Inside a container) → type "main" → Enter
7 match(es) boxed   →  [ Yes, refine ]  [ No, keep these ]
> (click Keep these)
```

Every step is a real button, and every step also exists as a flag
(`--in main --text price --visible --unique href`), so the interactive path and
the scriptable path are the same implementation.

## Notes and limits

- Refinement narrows the drawn set; a page mutation re-queries the selectors, so
  boxes can re-broaden after refining (documented).
- "Visible only" means rendered, not "in the viewport".
- Chained filters append until `filter -c` or `--replace`.
- `&&` (stop on error) is not implemented; a chain always runs every segment.
- Cross-origin panes cannot be boxed.

## Verification

- 559 jsdom checks and 78 checks in Chromium 150 with the extension unpacked,
  including the tokenizer (quotes/brackets/`\;`), chain order and continuation,
  clicking through Yes → Unique → No and Yes → Text → typed word → Keep these,
  `filter -y img; filter -y a` boxing three elements, and the per-pane maximize
  button flipping glyphs and restoring.
- Not verified: touch input, cross-origin panes, the 15s prompt timeout in a real
  browser, and refresh-after-refinement outside jsdom.

## Breaking changes

None. The filter question now comes *after* drawing instead of before, and
`yes`/`no` answer whatever prompt is open.

---

# BMUX Version 0.3.0 - Release Summary

## Release Information

**Version**: 0.3.0
**Release Date**: November 9, 2026
**Status**: Console and filter-usability release
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Pane console | Persistent scrollback with a scrollbar, toggle button, drag-to-resize, `log` command and `l` key; no more five-second auto-collapse |
| Debug console | Resizable from its bottom-right corner, still draggable |
| Filter presets | `filter links internal`, `images large`, `tables rows`, `media video`, `prices`, `comments`, … plus `filter --presets` |
| Confirmation | Presets and result sets over 25 ask first: `yes` / `no` (or `y` / `n` / `Esc`), with `filter -y` to skip |
| Zoom | `Shift+z` toggles zoom, the tmux `prefix + Z` binding |

## Why these three

1. **The pane console was write-once.** It showed one result, hid itself after
   five seconds and could not be reopened. It is now a scrollback that stays open,
   scrolls, toggles from the footer, and resizes by dragging its top edge — the
   height and open state per pane.
2. **`filter` needed vocabulary.** `filter links internal` now works because a
   preset can carry a predicate (`href` resolved against the pane's origin, with
   a base-URI fallback), which no selector can express alone. Presets and big
   results ask for a yes/no answer before drawing, so a stray `filter div` no
   longer paints a thousand boxes.
3. **tmux muscle memory.** `Ctrl+b` then `Shift+z` maximizes the focused pane and
   the same chord restores the layout, exactly like tmux (Control Mode `Shift+z`
   too; `z` still works).

## Verification

- 558 jsdom checks and 65 checks in Chromium 150 with the extension loaded
  unpacked, including: the console opening on a command and still being open after
  5.3s, a real grip drag making it taller, `log off`/`log on` preserving the
  scrollback, a preset asking before drawing with `yes` boxing it, `filter -y
  links internal` boxing only the on-site link, and `Shift+z` maximizing and
  restoring the pane.
- Not verified: touch input, cross-origin panes, and the 15-second prompt timeout
  in a real browser.

## Breaking changes

None. `clear` now empties the pane console scrollback rather than the old output
line, and `filter` asks before large queries; both are documented.

---

# BMUX Version 0.2.0 - Release Summary

## Release Information

**Version**: 0.2.0
**Release Date**: November 9, 2026
**Status**: Visual filter release
**License**: MIT

---

## Highlights

**`filter` now shows you what it found.** Every match gets a box inside the pane,
a numbered tab, and a name in the pane's status line while you hover it.

| Area | What shipped |
|------|--------------|
| Highlighting | `filter <selector>` boxes every match: outline, wash, corner ticks, index tab |
| Naming | Hover a match -> `FILTER: .card - DIV#alpha.card "Product card" · 1/2` in the pane footer, box turns green |
| Live | Debounced MutationObserver re-queries and redraws when the page changes |
| Limits | `filter -n <max>` (default 200, ceiling 1000), `filter -l` lists only |
| Clearing | `Esc` (top frame, inputs, or with focus inside the pane) and `filter -c` |
| Keys | New `escape` command, so keys relayed from a pane frame behave the same |

## How it is drawn

The boxes are sibling overlays appended to the pane document by the top frame:
one `[data-bmux-filter-layer]` with a `[data-bmux-filter]` per match, positioned in
document coordinates, `pointer-events: none`, styled by an injected `<style>`.
Nothing is wrapped, moved or restyled on the page itself, so the page's layout is
untouched; boxes scroll with the content and are removed as a unit.

Same-origin only: a cross-origin pane cannot be measured or written into, and
`filter` says so instead of pretending.

## Verification

- 481 jsdom checks and 49 checks in Chromium 150 with the extension loaded
  unpacked, including a real `filter .box` on a live page, real hover naming
  (`· 1/2` then `· 2/2`), Escape from console focus and from inside the pane, and
  `filter -c`.
- Not verified: cross-origin panes, touch input, and the MutationObserver refresh
  in a real browser (jsdom only).

## Breaking changes

None. `filter` without a selector is now a usage error, and its output wording
changed; the command still exists with the same name and scope.

---

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
