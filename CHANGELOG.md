# Changelog

All notable changes to BMUX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Pane focus navigation, pane identity, and a single command registry that every
entry point shares. Nothing here is released yet; the extension version stays at
0.0.1 until it is cut.

### Added

- **Directional pane focus**
  - `Up` / `Down` / `Left` / `Right` buttons in the toolbar, at the right-hand end.
    Each one runs `focus-pane <direction>` through the same dispatcher the console
    uses, so the buttons and the console cannot drift apart.
  - `focus-pane up|down|left|right` from the debug console, the `:` line, or a
    pane's input.
  - Arrow keys move focus in Control Mode and after the `Ctrl+b` prefix.
  - **Wrap-around:** when nothing lies in the requested direction, focus moves to
    the pane furthest on the opposite side. With two side-by-side panes and focus
    on the right one, `Right` lands on the left one.
  - Picking is geometric: the nearest pane whose centre lies in that direction
    wins, with a penalty for drifting off-axis, so the pane straight ahead beats a
    nearer one far off to the side. Layout is nested flexbox, so this reads real
    pane rectangles rather than assuming a grid.
  - Click to focus: clicking a pane's body or footer makes it the active pane.
  - Click into a pane's iframe: the click is inside another document, so the pane
    is focused from the window blur that names the iframe as `activeElement`
    (this works for cross-origin frames too).

- **Pane identity**
  - Each pane has an id (`%1`, `%2`, …) assigned once when the pane is created and
    never reused.
  - Each pane also has a number: its reading-order position, recomputed after a
    split or a new window so numbers always run 1..n.
  - Every pane footer shows a `[number id]` badge, e.g. `[2 %2]`.
  - `list-panes` prints each pane's number, id, active marker and URL.

- **Overlay commands are now available from the console**
  - `list-panes`, `focus-pane`, `split-window -h|-v`, `new-window`, `detach`,
    `kill-pane`, `control-mode` and `command-prompt` can be typed in the debug
    console, the `:` line, or a pane's input.
  - `help` lists every command, grouped by scope, generated from the registry.
  - The `:` line (Control Mode) is itself a command (`command-prompt`).

- **`BMUX_KEYBINDINGS`** in `content/commands.js`: Control Mode and `Ctrl+b` keys
  are mapped to command lines, so the keys, the buttons and the console all run
  the same commands.

### Changed

- **`content/commands.js` is the single source of truth.** Every command defines
  `scope` (`overlay` or `pane`), `description`, `usage` and
  `execute(api, args)`. Overlay commands live there too — not in `main.js`.
- **`content/main.js` holds no command definitions, no help text and no
  key-to-action switch.** It parses a line, looks the name up in the registry
  (own-property lookup) and calls `execute` with an `api` object
  (`{ client, pane, log }`). The client keeps only the primitives commands need:
  `getPanes`, `getPaneNumber`, `getPaneId`, `getActivePane`, `setActivePane`,
  `findPaneByToken`, `focusDirection`, `splitWindow`, `newWindow`, `toggle`,
  `setControlMode`, `showCommandMode`/`hideCommandMode`, `log`.
- Toolbar buttons run their command and log the line plus its result in the
  debug console. They no longer enter and leave Control Mode themselves.
- **Background relay carries a command line.** `relay-line` →
  `execute-line` with `{ line }`, replacing `relay-to-top` with `{ action, params }`.
  The background no longer knows any command names.
- `toggleControlMode()` is now a thin wrapper over `setControlMode(on)`, so
  entering and leaving Control Mode is one code path (`control-mode on|off|toggle`).
- Status bar right-hand side shows the focused pane, e.g. `pane 2 %2`.
- The debug console input placeholder now says what it does (run a command).
- Split and New Window refresh pane numbers and badges.

### Fixed

- **Prototype names can no longer resolve as commands or keys.** Lookups use
  `Object.prototype.hasOwnProperty.call`, so `constructor`, `__proto__`,
  `hasOwnProperty` and friends report `Unknown command` instead of calling an
  inherited function.
- **Bad arguments never throw.** An unknown pane number, an unknown pane id, a
  non-numeric token, a missing argument or an unknown flag return an error or
  usage line and leave focus where it was; a throw inside any command is caught
  by the dispatcher and reported as `Error: …`.
- The `:` line's open state is tracked explicitly. Previously the check read the
  inline `display` style, which is empty before the line is ever opened, so keys
  could be swallowed while the command input had focus.
- Control Mode key handling no longer dereferences the overlay UI in frames that
  have none (the content script also runs inside each pane's iframe, where
  `this.ui` is undefined).
- Pane output no longer shows an empty output box for commands that return
  nothing (`clear`).

### Notes

- `kill-pane` is registered and reports "not implemented". No pane is killed;
  `x` in Control Mode and `Ctrl+b x` say so instead of doing nothing silently.
- `new-window` still resets the overlay to a single pane; it discards the current
  layout (unchanged).
- Splitting still reloads the iframe of the pane being split, because moving an
  iframe in the DOM reloads it. Unchanged by this work and still worth a
  follow-up.
- `Escape` closes the `:` line and leaves Control Mode on; a second `Escape`
  leaves Control Mode. Unchanged.
- `docs/DESIGN.md`, `docs/UPDATE_STATUS.md` and `RELEASE_NOTES.md` are kept as
  historical documents and were not rewritten.

### Verification

- `node --check` on every changed script.
- **jsdom harness** (`content/commands.js` + `content/main.js` loaded as the
  manifest loads them, same script order, one global scope): 222 checks covering
  the toolbar, the dispatcher, both key tables, the `:` line, pane inputs, the
  debug console, click-to-focus, wrap-around in two-pane and 2x2 layouts, bad
  input, ids/numbers/badges, and the background relay. All pass.
- **Real browser**: the extension was loaded unpacked in Chromium 150 (headless,
  puppeteer-core) and 22 checks passed: overlay injected, one initial pane with
  id `%1` and badge `[1 %1]`, the four focus buttons present, `Split H` producing
  two panes with `%1`/`%2` badges, the toolbar command echoed in the console,
  `focus-pane right` wrapping from the right pane to the left pane using real pane
  geometry, the status bar showing `pane 1 %1`, `list-panes` from the console with
  the `[ACTIVE]` marker, Control Mode status, `ArrowRight` moving focus and
  wrapping, mousedown click-to-focus, and no uncaught page errors or BMUX console
  errors.
- **Not covered by any run**: the `Alt+Shift+B` global hotkey (a browser-level
  command that cannot be synthesised from DevTools; the browser harness un-hid the
  overlay directly instead), the popup buttons, the `Ctrl+b` prefix in a real
  browser, `chrome.storage` state, and `kill-pane` beyond its "not implemented"
  message. The click-inside-an-iframe focus path is only exercised against jsdom (a
  simulated window blur with an iframe as `activeElement`); no cross-origin frame was
  used in either run. Google Chrome 157 rejects `--load-extension`, so the browser run
  used `chromium`.
- Both harnesses are local only (`.verify/`, gitignored; they need `jsdom` and
  `puppeteer-core`) and are not part of the extension.

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

## Planned for 0.1.0

- Full state persistence
- Pane resizing
- Named sessions
- `kill-pane` actually closing a pane
- Splitting without reloading the split pane's iframe
- Better error handling

### Future Considerations
- Plugin/extension system
- Custom themes
- Cloud sync (optional)
- Firefox full compatibility
- Performance optimizations
