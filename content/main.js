/**
 * BMUX Content Script (Client)
 *
 * The client owns the overlay's DOM, the pane layout and focus. It holds no
 * command definitions, help text or key-to-action switch: every command lives
 * in `content/commands.js`, and every entry point (toolbar, debug console,
 * `:` line, pane inputs, keys, background relay) ends up in `runCommand`.
 *
 * Layout model
 * ------------
 * Panes are absolutely positioned inside `#bmux-panes`, and their geometry comes
 * from a binary split tree:
 *
 *     leaf  = { kind: 'leaf', pane: HTMLElement }
 *     split = { kind: 'split', direction: 'row' | 'column', ratio, first, second }
 *
 * `ratio` is the share of the split given to `first` (0..1). Every structural
 * edit — split, kill, resize, zoom, layout preset, swap, rotate — rewrites this
 * tree and recomputes rectangles. Pane elements are never moved in the DOM,
 * because moving an iframe in the DOM reloads it: with this model, splitting,
 * re-laying out, swapping and rotating keep every page alive.
 */

console.log("BMUX Client Loading...");
console.log("BMUX Client Loading in", window.self === window.top ? "TOP" : "FRAME", window.location.href);

// A pane centre must be at least this far along the requested axis to count as
// "in that direction"; anything closer is treated as the same position.
const BMUX_AXIS_EPSILON = 1;

// Weight applied to drifting off-axis (in pixels) when scoring a candidate, so
// the pane straight ahead beats a nearer one far off to the side.
const BMUX_DRIFT_WEIGHT = 2;

// How long the Ctrl+b prefix stays armed, in ms.
const BMUX_PREFIX_TIMEOUT = 3000;

// Gap kept between panes, in px, applied on both sides of every pane edge.
const BMUX_GUTTER = 4;

// Split shares are clamped so no pane can be squeezed to nothing by accident.
const BMUX_MIN_SHARE = 0.1;
const BMUX_MAX_SHARE = 0.9;

// Resize clamps are wider than split clamps: dragging a border should be able to
// approach an edge even though a fresh split should not.
const BMUX_MIN_RESIZE = 0.05;
const BMUX_MAX_RESIZE = 0.95;

// How long display-panes keeps the numbers on screen, in ms.
const BMUX_PANE_INDEX_TIMEOUT = 2000;

// Layout presets, in cycle order for next-layout.
const BMUX_LAYOUTS = ['even-horizontal', 'main-vertical', 'even-vertical', 'main-horizontal', 'tiled'];

// Filter highlights: how many boxes are drawn by default, and the hard ceiling.
const BMUX_FILTER_MAX = 200;
const BMUX_FILTER_MAX_HARD = 1000;

// How long a yes/no prompt stays open, in ms (text questions never time out).
const BMUX_PROMPT_TIMEOUT = 15000;

// How many matches `filter` will scan before it stops looking.
const BMUX_FILTER_SCAN_MAX = 5000;

// Digit-key shortcuts for prompt choices stop at 9.
const BMUX_PROMPT_MAX_KEYS = 9;

// Shell-style line editing: how many commands the shared history keeps.
const BMUX_HISTORY_LIMIT = 200;

// How many key events the `keys` diagnostic remembers.
const BMUX_KEY_LOG = 20;

// How tall a pane console may get, as a share of its pane.
const BMUX_CONSOLE_MAX_SHARE = 0.9;

// Layout persistence: debounce for saves, and how long to wait for the saved
// layout before rendering a fresh one anyway.
const BMUX_SAVE_DEBOUNCE = 400;
const BMUX_RESTORE_TIMEOUT = 800;

// Snapshot format, kept in step with background/main.js: version 2 stores a list
// of windows. The background upgrades v1 snapshots on read, so this side only
// ever has to apply v2.
const SNAPSHOT_VERSION = 2;
const BMUX_MAX_WINDOWS = 6;

// How long a pane frame gets to answer an inspection request (`list-storage`,
// `forms`, `eval`, …) before the command reports that it did not answer.
const BMUX_INSPECT_TIMEOUT = 1500;

// Tables wrap at this many characters so a table still fits a pane console.
const BMUX_TABLE_MAX_WIDTH = 96;
const BMUX_MAX_WINDOW_NAME = 32;

// Pane console: height when first opened, the drag limits, and scrollback cap.
const BMUX_CONSOLE_HEIGHT = 140;
const BMUX_CONSOLE_MIN_HEIGHT = 40;
const BMUX_CONSOLE_MAX_BLOCKS = 100;

// Debounce for re-drawing boxes when the filtered page changes underneath them.
const BMUX_FILTER_REFRESH_DELAY = 300;

// Styles for the boxes, injected into the filtered pane's own document so the
// overlay cannot be affected by the pane's CSS and is removed with it.
const BMUX_FILTER_CSS = `
[data-bmux-filter-layer] {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: 2147483646;
}
[data-bmux-filter] {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
  outline: 2px solid rgba(255, 214, 0, 0.95);
  outline-offset: 0;
  background: rgba(255, 214, 0, 0.10);
  border-radius: 2px;
}
[data-bmux-filter]::before,
[data-bmux-filter]::after {
  content: '';
  position: absolute;
  width: 7px;
  height: 7px;
  background: #ffd600;
}
[data-bmux-filter]::before { left: -3px; top: -3px; }
[data-bmux-filter]::after { right: -3px; bottom: -3px; }
[data-bmux-filter].bmux-filter-hover {
  outline-color: #00ff88;
  background: rgba(0, 255, 136, 0.18);
}
[data-bmux-filter].bmux-filter-hover::before,
[data-bmux-filter].bmux-filter-hover::after { background: #00ff88; }
.bmux-filter-index {
  position: absolute;
  left: 0;
  top: 0;
  transform: translateY(-100%);
  padding: 1px 4px;
  border-radius: 3px 3px 0 0;
  background: #ffd600;
  color: #000;
  font: 10px/1.2 'Consolas', monospace;
  pointer-events: none;
}
[data-bmux-filter].bmux-filter-hover .bmux-filter-index { background: #00ff88; }
`;

function bmuxClamp(value, low, high) {
    if (value < low) return low;
    if (value > high) return high;
    return value;
}

/**
 * Split a command line on top-level semicolons.
 *
 * Rules:
 *   - `;` separates commands, but only outside quotes and outside [] () {};
 *   - `\;` is a literal semicolon (and `\\` a literal backslash);
 *   - quotes are passed through untouched, because they belong to arguments
 *     (selectors such as `a[href="x;y"]` need them).
 *
 * So `filter img; filter a` is two commands, and
 * `filter a[href=\"x;y\"]` is one.
 */
function splitCommandLine(line) {
    const text = line == null ? '' : String(line);
    const segments = [];
    let current = '';
    let quote = null;
    let depth = 0;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const character = text[i];

        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }

        if (character === '\\') {
            escaped = true;
            continue;
        }

        if (quote) {
            current += character;
            if (character === quote) quote = null;
            continue;
        }

        if (character === '"' || character === "'") {
            quote = character;
            current += character;
            continue;
        }

        if (character === '[' || character === '(' || character === '{') depth++;
        if ((character === ']' || character === ')' || character === '}') && depth > 0) depth--;

        if (character === ';' && depth === 0) {
            segments.push(current.trim());
            current = '';
            continue;
        }

        current += character;
    }

    if (escaped) current += '\\';
    segments.push(current.trim());

    return segments.filter((segment) => segment.length > 0);
}

/**
 * Where the command being typed starts: the offset just after the last
 * top-level `;`, so completion and history work on the segment under the caret.
 */
function lastSegmentStart(text) {
    let quote = null;
    let depth = 0;
    let escaped = false;
    let start = 0;

    for (let i = 0; i < text.length; i++) {
        const character = text[i];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === '\\') {
            escaped = true;
            continue;
        }
        if (quote) {
            if (character === quote) quote = null;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === '[' || character === '(' || character === '{') depth++;
        if ((character === ']' || character === ')' || character === '}') && depth > 0) depth--;

        if (character === ';' && depth === 0) start = i + 1;
    }

    return start;
}

function longestCommonPrefix(values) {
    if (!values.length) return '';
    let prefix = values[0];

    for (let i = 1; i < values.length; i++) {
        while (prefix.length && values[i].slice(0, prefix.length) !== prefix) {
            prefix = prefix.slice(0, -1);
        }
        if (!prefix) return '';
    }

    return prefix;
}

/**
 * Own-property lookup. Command names and key bindings are data, not
 * prototypes: "constructor" or "__proto__" must report "unknown", never resolve
 * to an inherited function.
 */
function bmuxHasOwn(object, key) {
    return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Every name a binding table could use for this event, most specific first.
 *
 * `event.key` is layout-dependent and not always the symbol the user pressed:
 * with Shift held, some platforms report `5` where others report `%`, and the
 * same goes for `'` and `\"`. `event.code` is layout-independent, so the tables
 * can carry a `Shift+Digit5` / `Shift+Quote` alias next to `%` / `\"` and both
 * produce the same command.
 */
function bmuxBindingKeys(event) {
    const keys = [];
    const add = (candidate) => {
        if (!candidate) return;
        if (keys.indexOf(candidate) === -1) keys.push(candidate);
    };

    // The space bar reports " ", which is unreadable in a binding table.
    const key = event.key === ' ' ? 'Space' : event.key;
    const code = event.code || '';
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey;

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
        add(`Alt+${key}`);
        add(code ? `Alt+${code}` : '');
    } else if (plain) {
        add(key);
    }

    if (event.shiftKey && code) add(`Shift+${code}`);
    if (code) add(code);
    if (event.shiftKey && key.length === 1) add(`Shift+${key}`);
    if (key.length === 1) add(key.toLowerCase());

    return keys;
}

/**
 * Resolve a key event to the command line it runs, or null.
 * `mode` is 'control' or 'prefix'; the tables live in commands.js.
 */
function bmuxKeyBinding(mode, event) {
    if (typeof BMUX_KEYBINDINGS === 'undefined') return null;
    const table = BMUX_KEYBINDINGS[mode];
    if (!table) return null;

    const keys = bmuxBindingKeys(event);
    for (let i = 0; i < keys.length; i++) {
        if (bmuxHasOwn(table, keys[i])) return table[keys[i]];
    }
    return null;
}

/**
 * Pick the pane to focus.
 *
 * `rectOf(pane)` must return { cx, cy } (centre of the pane).
 *
 * A pane is a candidate when its centre lies further along `direction` than the
 * current pane's, and the one with the smallest forward distance wins, with a
 * penalty for drifting off-axis. When nothing lies in that direction the
 * selection wraps: the pane furthest on the opposite side is chosen, so two
 * side-by-side panes with focus on the right one wrap left on "right".
 *
 * Returns { pane, wrapped } or null.
 */
function pickPaneInDirection(panes, current, direction, rectOf) {
    if (!panes || panes.length < 2 || !current) return null;

    // Each direction is turned into "forward = bigger axis value".
    const axesOf = (rect) => {
        switch (direction) {
            case 'right': return { axis: rect.cx, perp: rect.cy };
            case 'left': return { axis: -rect.cx, perp: rect.cy };
            case 'down': return { axis: rect.cy, perp: rect.cx };
            case 'up': return { axis: -rect.cy, perp: rect.cx };
            default: return null;
        }
    };

    const currentAxes = axesOf(rectOf(current));
    if (!currentAxes) return null;

    const ahead = [];
    const others = [];

    panes.forEach((pane) => {
        if (pane === current) return;

        const axes = axesOf(rectOf(pane));
        if (!axes) return;

        const entry = {
            pane: pane,
            axis: axes.axis,
            drift: Math.abs(axes.perp - currentAxes.perp)
        };

        others.push(entry);

        if (axes.axis - currentAxes.axis > BMUX_AXIS_EPSILON) {
            entry.distance = axes.axis - currentAxes.axis;
            ahead.push(entry);
        }
    });

    if (ahead.length) {
        ahead.sort((a, b) => (a.distance + BMUX_DRIFT_WEIGHT * a.drift) -
            (b.distance + BMUX_DRIFT_WEIGHT * b.drift));
        return { pane: ahead[0].pane, wrapped: false };
    }

    if (!others.length) return null;

    // Wrap: the furthest pane on the opposite side, nearest by drift on a tie.
    others.sort((a, b) => {
        if (a.axis !== b.axis) return a.axis - b.axis;
        return a.drift - b.drift;
    });

    return { pane: others[0].pane, wrapped: true };
}

/**
 * Short, human name for a matched element: TAG#id.first-class, plus a title,
 * aria-label or text snippet when the element carries one.
 */
function bmuxDescribeElement(element) {
    if (!element || !element.tagName) return '?';

    let name = element.tagName;
    if (element.id) name += `#${element.id}`;

    const className = typeof element.className === 'string' ? element.className : '';
    if (className) {
        name += '.' + className.trim().split(/\s+/).slice(0, 3).join('.');
    }

    const attribute = element.getAttribute
        ? (element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('name') || '')
        : '';
    const snippet = attribute || (element.textContent || '').trim().replace(/\s+/g, ' ');

    if (snippet) name += ` "${snippet.slice(0, 32)}${snippet.length > 32 ? '…' : ''}"`;

    return name.slice(0, 96);
}

// --- Layout tree helpers (pure data, no DOM) ---

function bmuxLeaf(pane) {
    return { kind: 'leaf', pane: pane };
}

/** Evenly split a list of nodes in `direction` (halves, recursively). */
function bmuxEvenSplitNodes(nodes, direction) {
    if (nodes.length === 1) return nodes[0];

    const mid = Math.ceil(nodes.length / 2);
    return {
        kind: 'split',
        direction: direction,
        ratio: mid / nodes.length,
        first: bmuxEvenSplitNodes(nodes.slice(0, mid), direction),
        second: bmuxEvenSplitNodes(nodes.slice(mid), direction)
    };
}

function bmuxEvenSplitPanes(panes, direction) {
    return bmuxEvenSplitNodes(panes.map(bmuxLeaf), direction);
}

/** First pane on the left/top, the rest stacked beside/below it. */
function bmuxMainSplit(panes, direction, mainShare) {
    const main = bmuxLeaf(panes[0]);
    const rest = panes.slice(1);
    if (!rest.length) return main;

    const stackDirection = direction === 'row' ? 'column' : 'row';
    return {
        kind: 'split',
        direction: direction,
        ratio: mainShare,
        first: main,
        second: bmuxEvenSplitPanes(rest, stackDirection)
    };
}

/** Rows of equal height, each an even horizontal split. */
function bmuxTiled(panes) {
    const columns = Math.ceil(Math.sqrt(panes.length));
    const rows = [];

    for (let i = 0; i < panes.length; i += columns) {
        rows.push(bmuxEvenSplitPanes(panes.slice(i, i + columns), 'row'));
    }

    return bmuxEvenSplitNodes(rows, 'column');
}

class BMUXClient {
    constructor() {
        this.isTop = window.self === window.top;
        this.isActive = false; // Visibility state (only relevant for Top)
        this.prefixPressed = false;
        this.prefixTimeout = null;

        this.isControlMode = false;
        this.commandLineOpen = false;
        this.nextPaneId = 1;

        this.layout = null;        // root of the split tree
        this.layoutName = null;    // preset name, or null once edited by hand
        this.rects = new Map();    // pane -> { x, y, w, h } fractions
        this.zoomedPane = null;
        this.lastActivePane = null;

        this.paneIndexPrompt = false;
        this.paneIndexTimer = null;

        this.filters = new Map();  // pane -> filter highlight state
        this.prompts = new Map();  // pane -> open prompt card

        this.commandHistory = [];     // shared shell-style history for every input
        this.keyLog = [];             // recent key events, for the `keys` command

        this.rootPane = null;         // the pane that represents this tab's own page
        this.restoredNote = '';       // why the restored layout looks the way it does

        // Windows: the fields above describe the ACTIVE window. Inactive windows
        // keep their own copy here, which is what a switch swaps in — so every
        // command, focus routine and renderer keeps working on "the layout".
        this.windows = [];
        this.activeWindowIndex = 0;
        this.nextWindowId = 1;

        this.theme = 'frost';         // 'frost' (default) or 'classic'
        this.debugOpen = false;       // the floating debug window is optional
        this.verbose = false;         // mirror debug output into the focused pane

        this.persistEnabled = true;   // auto-restore switch (from the background)
        this.persistInherit = true;   // new tabs inherit the newest layout
        this.restoring = false;       // true while a snapshot is being applied
        this.restoredFrom = 'fresh';  // 'fresh' | 'session' | 'named'
        this.saveTimer = null;

        this.scriptRun = null;        // the .bmux script being run, if any
        this.scriptName = 'script';   // label of the script in the panel
        this.scriptPanelOpen = false;
        this.scriptProgress = '';
        this.scriptRunOnLoad = false; // `script file --run` starts it on load
        this.toolbarButtons = [];             // the toolbar's buttons, from config
        this.toolbarSource = 'default';
        this.pendingInspections = new Map();  // nonce -> { resolve, timer, source }
        this.inspectNonce = 0;
        this.sleepState = null;       // the pending `sleep`, so `script stop` can cut it

        this.ui = null;
        this.handles = [];

        this.init();
    }

    init() {
        if (this.isTop) {
            this.injectUI();
        }
        this.setupListeners();
        this.log("Initialized. waiting for Alt+Shift+B");

        // Restore the saved layout before the first pane is drawn, so nothing
        // flashes: loadPersistedLayout() renders either the snapshot or a fresh
        // window.
        if (this.isTop) {
            this.loadPersistedLayout();
        }
    }

    log(msg) {
        console.log("[BMUX client]", msg);

        if (this.ui && this.ui.debug) {
            const line = document.createElement('div');
            line.textContent = `> ${msg}`;
            this.ui.debug.appendChild(line);
            this.ui.debug.scrollTop = this.ui.debug.scrollHeight;
        }

        // With the debug window hidden there would be nowhere to read this, so
        // verbose mode mirrors it into the focused pane's console instead.
        if (this.verbose && this.ui) {
            const pane = this.getActivePane();
            if (pane) this.appendPaneOutput(pane, String(msg), 'result');
        }
    }

    /** Show or hide the floating debug window. */
    setDebugOpen(open) {
        this.debugOpen = !!open;
        if (this.ui && this.ui.debugContainer) {
            this.ui.debugContainer.classList.toggle('bmux-debug-hidden', !this.debugOpen);
        }
        this.scheduleSave();
        return this.debugOpen;
    }

    /** Mirror debug output into the focused pane console, or stop doing that. */
    setVerbose(on) {
        this.verbose = !!on;
        if (this.verbose) {
            this.log('Verbose on: debug output is mirrored into the focused pane console');
        }
        this.scheduleSave();
        return this.verbose;
    }

    /** 'frost' palette (default) or the original 'classic' black/green. */
    /** The palettes `setTheme` accepts (kept in commands.js with the other vocab). */
    themes() {
        return typeof BMUX_THEMES !== 'undefined' ? BMUX_THEMES.slice() : ['frost', 'classic'];
    }

    /** 'frost' (default), 'classic', 'midnight', 'amber', 'light', 'nord', 'rose'. */
    setTheme(name) {
        const asked = String(name || '').toLowerCase();
        const themes = this.themes();
        const picked = themes.indexOf(asked) === -1 ? 'frost' : asked;

        const changed = this.theme !== picked;
        this.theme = picked;
        if (this.ui) this.ui.overlay.dataset.theme = picked;
        if (changed || !this.theme) this.log(`Theme: ${picked}`);
        this.scheduleSave();
        return this.theme;
    }

    isTypingTarget(event) {
        const isField = (element) => !!element &&
            (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA');

        if (isField(document.activeElement)) return true;
        return isField(event && event.target);
    }

    /**
     * Control Mode setter. The buttons and keys call this through the
     * `control-mode` command, so entering and leaving is a command like any
     * other and the state is always restored by the same code path.
     */
    setControlMode(on) {
        const next = !!on;
        const changed = this.isControlMode !== next;
        this.isControlMode = next;

        if (this.ui) {
            // A quiet inset ring and a tinted status chip, not a five-pixel
            // frame around the whole page.
            this.ui.overlay.style.border = 'none';
            this.ui.overlay.classList.toggle('bmux-control-active', next);
            this.ui.statusLeft.classList.toggle('bmux-status-active', next);
            this.ui.statusLeft.textContent = next ? 'CONTROL MODE' : 'NORMAL';
        }

        if (changed) {
            this.log(`Control Mode: ${next}`);
        }
    }

    toggleControlMode() {
        this.setControlMode(!this.isControlMode);
    }

    injectUI() {
        if (document.getElementById('bmux-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'bmux-overlay';
        overlay.className = 'hidden';

        overlay.innerHTML = `
          <!-- Buttons are rendered from the saved toolbar configuration
               (Settings in the extension menu), so this starts empty. -->
          <div id="bmux-toolbar">
             <div id="bmux-toolbar-brand" title="BMUX — click the extension icon for the menu">
                <span class="bmux-brand-name">BMUX</span>
                <span class="bmux-brand-version" id="bmux-toolbar-version"></span>
             </div>
             <div id="bmux-toolbar-buttons"></div>
          </div>

          <div id="bmux-panes">
            <!-- Panes are absolutely positioned children; handles sit above them -->
            <div id="bmux-handles"></div>
          </div>

          <!-- Detached pane consoles float here -->
          <div id="bmux-floating"></div>

          <!-- Draggable Debug Console -->
          <div id="bmux-debug-overlay">
             <div id="bmux-debug-header">Debug Console</div>
             <div id="bmux-debug-content"></div>
             <div id="bmux-debug-input-container">
                <span style="color:#0f0; margin-right:5px;">$</span>
                <input id="bmux-debug-input" type="text" placeholder="Run a command (help lists them)" />
             </div>
          </div>

          <!-- .bmux script panel: paste commands, load a file, run it paced -->
          <div id="bmux-script-panel" class="bmux-script-hidden">
             <div id="bmux-script-header">
                <span id="bmux-script-title">SCRIPT</span>
                <span id="bmux-script-progress">ready</span>
                <button class="bmux-script-btn" id="bmux-script-run-btn" title="Run the script (Ctrl+Enter)">Run</button>
                <button class="bmux-script-btn" id="bmux-script-stop-btn" title="Stop after the current command">Stop</button>
                <button class="bmux-script-btn" id="bmux-script-file-btn" title="Load a .bmux file from disk">File</button>
                <button class="bmux-script-btn" id="bmux-script-close-btn" title="Close this panel">&#215;</button>
             </div>
             <textarea id="bmux-script-text" spellcheck="false" placeholder="# .bmux script - one command per line; sleep 2 pauses between steps"></textarea>
             <input id="bmux-script-file-input" type="file" accept=".bmux,text/plain" style="display:none" />
          </div>

          <div id="bmux-command-line">
            <span>:</span>
            <input id="bmux-command-input" type="text" />
          </div>

          <!-- Covers the overlay while a split boundary is dragged, so the
               pointer cannot slip over a pane iframe mid-drag -->
          <div id="bmux-drag-shield"></div>

          <div id="bmux-status-bar">
            <span id="bmux-status-left">[NORMAL]</span>
            <button id="bmux-status-window" class="bmux-status-window" title="Next window (n)">1:main</button>
            <span id="bmux-status-right">Ready</span>
          </div>
        `;

        overlay.dataset.theme = this.theme;

        document.body.appendChild(overlay);

        // Cache Elements
        this.ui = {
            overlay: overlay,
            panes: overlay.querySelector('#bmux-panes'),
            floating: overlay.querySelector('#bmux-floating'),
            handles: overlay.querySelector('#bmux-handles'),
            statusBar: overlay.querySelector('#bmux-status-bar'),
            statusLeft: overlay.querySelector('#bmux-status-left'),
            statusWindow: overlay.querySelector('#bmux-status-window'),
            statusRight: overlay.querySelector('#bmux-status-right'),
            commandLine: overlay.querySelector('#bmux-command-line'),
            commandInput: overlay.querySelector('#bmux-command-input'),

            dragShield: overlay.querySelector('#bmux-drag-shield'),

            scriptPanel: overlay.querySelector('#bmux-script-panel'),
            scriptName: overlay.querySelector('#bmux-script-title'),
            scriptProgress: overlay.querySelector('#bmux-script-progress'),
            scriptText: overlay.querySelector('#bmux-script-text'),
            scriptRunButton: overlay.querySelector('#bmux-script-run-btn'),
            scriptStopButton: overlay.querySelector('#bmux-script-stop-btn'),
            scriptFileButton: overlay.querySelector('#bmux-script-file-btn'),
            scriptCloseButton: overlay.querySelector('#bmux-script-close-btn'),
            scriptFileChoice: overlay.querySelector('#bmux-script-file-input'),

            debug: overlay.querySelector('#bmux-debug-content'),
            debugHeader: overlay.querySelector('#bmux-debug-header'),
            debugContainer: overlay.querySelector('#bmux-debug-overlay'),
            debugInput: overlay.querySelector('#bmux-debug-input'),

            toolbar: overlay.querySelector('#bmux-toolbar'),
            toolbarBrand: overlay.querySelector('#bmux-toolbar-brand'),
            toolbarVersion: overlay.querySelector('#bmux-toolbar-version'),
            toolbarButtons: overlay.querySelector('#bmux-toolbar-buttons')
        };

        // The toolbar is data: entries come from the saved configuration and every
        // button runs its command through the same dispatcher as the console, so a
        // custom button cannot behave differently from a typed command.
        this.renderToolbar();

        // Bind the debug console input: history, completion and Enter.
        this.bindCommandInput(this.ui.debugInput, {
            onSubmit: (cmd) => this.runLine(cmd),
            report: (text) => this.log(text)
        });

        // The `:` line gets the same editing keys; its Enter is handled by the
        // document key handler in handleKey().
        this.bindCommandInput(this.ui.commandInput, {
            report: (text) => this.log(text)
        });

        // The toolbar is drawn from the saved configuration; the built-in set
        // renders immediately so the overlay is never empty while that is in flight.
        this.toolbarButtons = this.defaultToolbar();
        this.renderToolbar();
        this.loadToolbar();


        // The window chip is the mouse path to the next window (n does the same).
        if (this.ui.statusWindow) {
            this.ui.statusWindow.onclick = (event) => {
                if (event) event.stopPropagation();
                this.runCommandAndLog('next-window');
            };
        }

        // The script panel runs `.bmux` text: Run / Stop / File, plus Ctrl+Enter.
        if (this.ui.scriptRunButton) {
            this.ui.scriptRunButton.onclick = () => {
                this.runScript(this.ui.scriptText ? this.ui.scriptText.value : '', { name: this.scriptName })
                    .then((summary) => { if (summary) this.log(summary); });
            };
        }
        if (this.ui.scriptStopButton) {
            this.ui.scriptStopButton.onclick = () => this.stopScript();
        }
        if (this.ui.scriptFileButton) {
            this.ui.scriptFileButton.onclick = () => this.scriptLoadFile(false);
        }
        if (this.ui.scriptCloseButton) {
            this.ui.scriptCloseButton.onclick = () => this.setScriptPanelOpen(false);
        }
        if (this.ui.scriptText) {
            this.ui.scriptText.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.runScript(this.ui.scriptText.value, { name: this.scriptName });
                }
            });
        }
        if (this.ui.scriptFileChoice) {
            this.ui.scriptFileChoice.addEventListener('change', (event) => this.handleScriptFile(event));
        }

        // The debug window is optional (`debug on|off|toggle`); it starts hidden
        // and verbose mode sends its output to the focused pane instead.
        this.ui.debugContainer.classList.toggle('bmux-debug-hidden', !this.debugOpen);

        // Make Debug Draggable, and resizable from its bottom-right corner
        this.makeDraggable(this.ui.debugContainer, this.ui.debugHeader);

        const debugGrip = document.createElement('div');
        debugGrip.className = 'bmux-debug-grip';
        debugGrip.title = 'Drag to resize the console';
        this.ui.debugContainer.appendChild(debugGrip);
        this.makeResizable(this.ui.debugContainer, debugGrip);

        const debugBottom = document.createElement('div');
        debugBottom.className = 'bmux-debug-bottom';
        debugBottom.title = 'Drag to change the console height';
        this.ui.debugContainer.appendChild(debugBottom);
        this.makeResizable(this.ui.debugContainer, debugBottom, { axis: 'y' });

        // The first render happens in loadPersistedLayout(), after the saved
        // layout has been read, so a restore never flashes an empty overlay.
    }

    /** Resize a fixed-position panel by dragging a grip (corner, or height only). */
    makeResizable(element, grip, options) {
        const opts = options || {};
        const verticalOnly = opts.axis === 'y';

        grip.addEventListener('mousedown', (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();

            const startX = event.clientX;
            const startY = event.clientY;
            const startWidth = element.offsetWidth;
            const startHeight = element.offsetHeight;
            const previousCursor = document.body.style.cursor;
            document.body.style.cursor = verticalOnly ? 'ns-resize' : 'nwse-resize';

            const shield = this.ui ? this.ui.dragShield : null;
            if (shield) shield.className = verticalOnly ? 'active row' : 'active';

            const move = (moveEvent) => {
                if (!verticalOnly) {
                    element.style.width = `${bmuxClamp(startWidth + (moveEvent.clientX - startX), 220, window.innerWidth - 40)}px`;
                }
                element.style.height = `${bmuxClamp(startHeight + (moveEvent.clientY - startY), 140, window.innerHeight - 80)}px`;
            };

            const up = () => {
                document.removeEventListener('mousemove', move, true);
                document.removeEventListener('mouseup', up, true);
                document.body.style.cursor = previousCursor;
                if (shield) shield.className = '';
            };

            document.addEventListener('mousemove', move, true);
            document.addEventListener('mouseup', up, true);
        });
    }

    makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    setupListeners() {
        // Pane frames report the pointer and inspection answers as window
        // messages: focus first (cheap), then inspection replies.
        window.addEventListener('message', (event) => {
            if (this.handlePaneFocus(event)) return;
            this.handleInspectReply(event);
        });

        // 1. Message Listener (from Background or Popup)
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (this.isTop && request.command === 'toggle-bmux') {
                this.toggle();
                sendResponse({ status: 'ok' });
            }

            // Command line relayed from the Background (a key pressed in a pane's
            // iframe, or in this frame when it is not the top frame)
            if (this.isTop && request.command === 'execute-line') {
                this.runLine(request.line);
                sendResponse({ status: 'ok' });
            }

            if (this.isTop && request.command === 'toggle-control-mode') {
                this.toggleControlMode();
                sendResponse({ status: 'ok' });
            }
        });

        // 2. Key Listener (Capture locally and send to background)
        document.addEventListener('keydown', (e) => this.handleKey(e), true);

        // 3. Focus sync: a click into a pane's iframe focuses the iframe, and
        // for a cross-origin frame that is all we can observe. The main window
        // blurring with an iframe as activeElement means that iframe's pane was
        // clicked, so make it the active pane.
        window.addEventListener('blur', () => this.syncActivePaneFromFocus(), true);

        // 3b. Inside a pane's frame: report pointer activity to the parent.
        //
        // A click on a page lands in the iframe, not on the pane element, and
        // moving between two iframes never blurs the top window — which is why
        // only the footer used to change the active pane. The frame can see its
        // own pointer events, so it tells the parent, which maps window -> pane.
        if (!this.isTop) {
            const tellParent = () => {
                try {
                    window.parent.postMessage({ __bmuxPaneFocus: true }, '*');
                } catch (error) {
                    // The parent went away (pane removed): nothing to report.
                }
            };

            document.addEventListener(window.PointerEvent ? 'pointerdown' : 'mousedown', tellParent, true);
            window.addEventListener('focus', tellParent, true);
        }

        // 4. The overlay can be resized; pane rects are fractions, so one render
        // keeps every pane proportional to the new size. Filter boxes are in
        // document coordinates, so they are re-measured as well.
        window.addEventListener('resize', () => {
            if (this.ui) this.renderLayout({ persist: false });
            Array.from(this.filters.keys()).forEach((pane) => this.refreshFilter(pane));
        });

        // Leaving the page: saving on visibility change is the reliable hook (an
        // MV3 tab can be torn down without a pagehide that finishes its work);
        // pagehide stays as the backstop.
        const saveOnExit = (reason) => {
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.saveNow(reason);
        };

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) saveOnExit('hidden');
        });
        window.addEventListener('pagehide', () => saveOnExit('pagehide'));
    }

    /**
     * Ask the background something about persistence and wait (briefly) for the
     * answer. Resolves null on timeout or when the background cannot be reached,
     * so a dead service worker can never block the overlay.
     */
    persistRequest(message, timeoutMs) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            const timer = timeoutMs ? setTimeout(() => finish(null), timeoutMs) : null;

            try {
                chrome.runtime.sendMessage(message, (reply) => {
                    if (timer) clearTimeout(timer);
                    const failed = chrome.runtime && chrome.runtime.lastError;
                    finish(failed ? null : (reply || null));
                });
            } catch (e) {
                if (timer) clearTimeout(timer);
                finish(null);
            }
        });
    }

    /** Restore the tab's saved layout, or render a fresh window. */
    async loadPersistedLayout() {
        if (!this.isTop || !this.ui) return;

        const reply = await this.persistRequest({ command: 'persist-load' }, BMUX_RESTORE_TIMEOUT);

        if (reply && reply.inherit !== undefined) this.persistInherit = reply.inherit !== false;
        if (reply && reply.enabled !== undefined) {
            // Anything but an explicit false counts as on, so a corrupt stored
            // value can never silently disable restoring.
            this.persistEnabled = reply.enabled !== false;
        }

        if (reply && reply.snapshot) {
            const applied = this.applySnapshot(reply.snapshot);
            if (applied.ok) {
                this.restoredFrom = reply.inheritedFrom ? 'inherited' : 'session';

                if (reply.inheritedFrom) {
                    this.restoredNote = `inherited from tab ${reply.inheritedFrom}`;
                    this.log(`New tab: inherited the layout from tab ${reply.inheritedFrom} ` +
                        `(${applied.panes} pane(s); this tab's page is in ${this.getPaneId(this.rootPane)})`);
                } else {
                    this.log(`Layout restored: ${applied.panes} pane(s)` +
                        (this.restoredNote ? ` (${this.restoredNote})` : ''));
                }
                return;
            }
            this.log(`Saved layout ignored: ${applied.reason}`);
        } else if (reply && reply.reason) {
            this.log(`No saved layout: ${reply.reason}`);
        }

        this.ensureFirstWindow();
    }

    /** The current layout as a versioned, transport-safe snapshot. */
    /** One node of a split tree as transport data. */
    serializeNode(node) {
        if (!node) return null;
        if (node.kind === 'leaf') {
            const pane = node.pane;
            const data = { id: this.getPaneId(pane), url: this.getPaneUrl(pane) };
            const custom = pane && pane.dataset ? pane.dataset.paneTitle : '';
            if (custom) data.title = custom;
            return { kind: 'leaf', pane: data };
        }
        return {
            kind: 'split',
            direction: node.direction,
            ratio: Number(Number(node.ratio).toFixed(4)),
            first: this.serializeNode(node.first),
            second: this.serializeNode(node.second)
        };
    }

    /** The active pane of a window record (by the `active` class), or its first. */
    activePaneOf(record) {
        const panes = [];
        this.collectPaneRefs(record.layout, panes);
        const active = panes.find((pane) => pane.classList.contains('active'));
        return active || panes[0] || null;
    }

    /** The current layout of every window, as a versioned snapshot. */
    serializeLayout() {
        if (!this.windows.length || !this.layout) return null;

        this.stashActiveWindow();

        let origin = window.location.href;
        try {
            origin = window.location.origin === 'null' ? window.location.href : window.location.origin;
        } catch (e) {
            origin = window.location.href;
        }

        // Consoles are keyed by pane id, so they travel with the snapshot once,
        // not once per window.
        const consoles = {};
        this.allPanes().forEach((pane) => {
            const meta = {
                open: this.isPaneConsoleOpen(pane),
                height: this.getPaneConsoleHeight(pane)
            };

            if (this.isPaneConsoleFloating(pane) && pane._bmuxFloat) {
                meta.floating = true;
                meta.floatRect = {
                    left: pane._bmuxFloat.offsetLeft,
                    top: pane._bmuxFloat.offsetTop,
                    width: pane._bmuxFloat.offsetWidth,
                    height: pane._bmuxFloat.offsetHeight
                };
            }

            consoles[this.getPaneId(pane)] = meta;
        });

        const windows = this.windows.map((record) => {
            const active = this.activePaneOf(record);
            return {
                name: record.name,
                layoutName: record.layoutName || null,
                rootPaneId: record.rootPane ? this.getPaneId(record.rootPane) : null,
                activeId: active ? this.getPaneId(active) : null,
                zoomedId: record.zoomedPane ? this.getPaneId(record.zoomedPane) : null,
                layout: this.serializeNode(record.layout)
            };
        });

        return {
            version: SNAPSHOT_VERSION,
            savedAt: Date.now(),
            origin: origin,
            url: window.location.href,
            nextPaneId: this.nextPaneId,
            prefs: {
                theme: this.theme,
                debugOpen: this.debugOpen,
                verbose: this.verbose
            },
            consoles: consoles,
            activeWindow: this.activeWindowIndex,
            windows: windows
        };
    }

    /** Rebuild the overlay from a version-2 snapshot. Never throws. */
    applySnapshot(snapshot) {
        if (!snapshot || snapshot.version !== SNAPSHOT_VERSION ||
            !Array.isArray(snapshot.windows) || !snapshot.windows.length) {
            return { ok: false, reason: 'unsupported snapshot' };
        }

        this.restoring = true;
        try {
            this.clearPaneIndexes();
            this.clearAllFilters();
            this.cancelPrompts();
            this.zoomedPane = null;
            this.layout = null;
            this.layoutName = null;
            this.lastActivePane = null;
            this.rootPane = null;
            this.rects = new Map();
            this.windows = [];
            this.activeWindowIndex = 0;

            this.allPanes().forEach((pane) => pane.remove());

            const currentUrl = window.location.href;
            const savedUrl = typeof snapshot.url === 'string' ? snapshot.url : '';
            const followed = !!savedUrl && savedUrl !== currentUrl;

            const requested = Number(snapshot.activeWindow);
            const activeIndex = Number.isInteger(requested) && requested >= 0 && requested < snapshot.windows.length
                ? requested
                : 0;

            const byId = new Map();

            const build = (node, ctx) => {
                if (!node) return null;

                if (node.kind === 'leaf') {
                    const data = node.pane || {};
                    const isRoot = ctx.isRoot && String(data.id) === ctx.rootId;
                    const pane = this.createPaneElement(isRoot ? currentUrl : (data.url || currentUrl));
                    if (data.id) pane.dataset.paneId = String(data.id);
                    if (data.title) pane.dataset.paneTitle = String(data.title);
                    pane.dataset.windowId = ctx.record.id;
                    byId.set(pane.dataset.paneId, pane);
                    this.ui.panes.appendChild(pane);
                    return { kind: 'leaf', pane: pane };
                }

                if (node.kind !== 'split' || (node.direction !== 'row' && node.direction !== 'column')) {
                    return null;
                }

                const first = build(node.first, ctx);
                const second = build(node.second, ctx);
                if (!first) return second;
                if (!second) return first;

                return {
                    kind: 'split',
                    direction: node.direction,
                    ratio: bmuxClamp(Number(node.ratio) || 0.5, BMUX_MIN_SHARE, BMUX_MAX_SHARE),
                    first: first,
                    second: second
                };
            };

            // Windows: each entry keeps its own tree, ids and saved focus.
            snapshot.windows.forEach((entry, index) => {
                const data = entry && typeof entry === 'object' ? entry : {};
                const record = this.createWindowRecord(data.name);
                if (data.name) record.name = String(data.name).slice(0, BMUX_MAX_WINDOW_NAME);
                record.layoutName = data.layoutName || null;

                const ctx = {
                    record: record,
                    isRoot: followed && index === activeIndex,
                    rootId: data.rootPaneId ? String(data.rootPaneId) : ''
                };

                record.layout = build(data.layout, ctx);
                record.rootPaneId = ctx.rootId || null;
                record.savedActiveId = data.activeId ? String(data.activeId) : null;
                record.savedZoomedId = data.zoomedId ? String(data.zoomedId) : null;

                if (record.layout) this.windows.push(record);
            });

            if (!this.windows.length) {
                this.restoring = false;
                return { ok: false, reason: 'empty layout' };
            }

            this.activeWindowIndex = Math.min(activeIndex, this.windows.length - 1);

            const prefs = snapshot.prefs || {};
            if (prefs.theme) this.setTheme(prefs.theme);
            if (prefs.verbose !== undefined) this.setVerbose(prefs.verbose);
            if (prefs.debugOpen !== undefined) this.setDebugOpen(prefs.debugOpen);

            const consoles = snapshot.consoles || {};
            this.allPanes().forEach((pane) => {
                const saved = consoles[this.getPaneId(pane)];
                if (!saved) return;
                if (saved.height) pane.dataset.consoleHeight = String(saved.height);
                if (saved.open) this.setPaneConsoleOpen(pane, true);

                if (saved.floating) {
                    this.setPaneConsoleFloating(pane, true);
                    const rect = saved.floatRect;
                    if (rect && pane._bmuxFloat) {
                        pane._bmuxFloat.style.left = `${Math.round(rect.left)}px`;
                        pane._bmuxFloat.style.top = `${Math.round(rect.top)}px`;
                        pane._bmuxFloat.style.width = `${Math.round(rect.width)}px`;
                        pane._bmuxFloat.style.height = `${Math.round(rect.height)}px`;
                    }
                }
            });

            const highestId = this.allPanes().reduce((max, pane) => {
                const number = parseInt(String(this.getPaneId(pane)).replace('%', ''), 10);
                return Number.isFinite(number) ? Math.max(max, number) : max;
            }, 0);

            const savedNextId = parseInt(snapshot.nextPaneId, 10);
            this.nextPaneId = Math.max(
                Number.isFinite(savedNextId) ? savedNextId : 0,
                highestId + 1,
                this.nextPaneId
            );

            // Per-window focus and zoom, resolved against that window's panes.
            this.windows.forEach((record) => {
                const panes = [];
                this.collectPaneRefs(record.layout, panes);

                panes.forEach((pane) => pane.classList.remove('active'));

                const savedActive = record.savedActiveId ? byId.get(record.savedActiveId) : null;
                const chosen = savedActive && panes.indexOf(savedActive) !== -1 ? savedActive : panes[0];
                if (chosen) chosen.classList.add('active');

                const savedZoomed = record.savedZoomedId ? byId.get(record.savedZoomedId) : null;
                record.zoomedPane = savedZoomed && panes.indexOf(savedZoomed) !== -1 ? savedZoomed : null;
                record.lastActivePane = null;

                if (!record.rootPane) {
                    const rootId = record.rootPaneId;
                    record.rootPane = (rootId && byId.get(rootId)) || panes[0] || null;
                }
                if (record.layout) {
                    // rootPane was assigned when the tree was built; keep it valid.
                    record.rootPane = panes.indexOf(record.rootPane) === -1 ? panes[0] : record.rootPane;
                }

                delete record.savedActiveId;
                delete record.savedZoomedId;
                delete record.rootPaneId;
            });

            this.unstashWindow(this.getActiveWindow());
            this.applyWindowVisibility();

            if (followed) {
                this.restoredNote = 'followed the page';
                this.log(`Layout follows this tab's page: ${this.getPaneId(this.rootPane)} now shows ${currentUrl}`);
            }

            this.renderLayout();
            this.stashActiveWindow();
            this.restoredFrom = 'session';

            return {
                ok: true,
                panes: this.allPanes().length,
                windows: this.windows.length
            };
        } catch (error) {
            return { ok: false, reason: error && error.message ? error.message : String(error) };
        } finally {
            this.restoring = false;
        }
    }

    /** Debounced save of the current layout (session layer). */
    scheduleSave() {
        if (!this.isTop || !this.ui || this.restoring || !this.persistEnabled || !this.layout) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveNow();
        }, BMUX_SAVE_DEBOUNCE);
    }

    /** Write the current layout now. */
    saveNow(reason) {
        if (!this.isTop || !this.persistEnabled) return Promise.resolve(null);

        const snapshot = this.serializeLayout();
        if (!snapshot) return Promise.resolve(null);

        return this.persistRequest({ command: 'persist-save', snapshot: snapshot }, 1500)
            .then((reply) => {
                if (reason) this.log(`Layout saved (${reason})`);
                return reply;
            });
    }

    // --- persistence used by the commands ---

    /** Whether brand-new tabs inherit the newest layout. */
    setPersistInherit(inherit) {
        this.persistInherit = !!inherit;
        return this.persistRequest({ command: 'persist-set-inherit', inherit: !!inherit }, 1500)
            .then((reply) => ({
                ok: !!(reply && reply.status === 'ok'),
                inherit: this.persistInherit
            }));
    }

    setPersistEnabled(enabled) {
        this.persistEnabled = !!enabled;
        return this.persistRequest({ command: 'persist-set-enabled', enabled: !!enabled }, 1500)
            .then((reply) => ({
                ok: !!(reply && reply.status === 'ok'),
                enabled: this.persistEnabled
            }));
    }

    saveNamedLayout(name) {
        const snapshot = this.serializeLayout();
        if (!snapshot) return Promise.resolve({ ok: false, reason: 'nothing to save' });

        return this.persistRequest({ command: 'layout-save', name: name, snapshot: snapshot }, 2000)
            .then((reply) => reply || { ok: false, reason: 'no answer from the background' });
    }

    listNamedLayouts() {
        return this.persistRequest({ command: 'layout-list' }, 2000).then((reply) => {
            if (!reply) return { ok: false, reason: 'no answer from the background', layouts: [] };
            return { ok: true, origin: reply.origin, layouts: reply.layouts || [] };
        });
    }

    restoreNamedLayout(name) {
        return this.persistRequest({ command: 'layout-load', name: name }, 2000).then((reply) => {
            if (!reply) return { ok: false, reason: 'no answer from the background' };
            if (!reply.snapshot) return { ok: false, reason: reply.reason || 'not found' };

            const applied = this.applySnapshot(reply.snapshot);
            if (!applied.ok) return { ok: false, reason: applied.reason };

            this.restoredFrom = 'named';
            return { ok: true, panes: applied.panes, name: reply.name || name };
        });
    }

    deleteNamedLayout(name) {
        return this.persistRequest({ command: 'layout-delete', name: name }, 2000)
            .then((reply) => reply || { ok: false, reason: 'no answer from the background' });
    }

    /**
     * Activation is one state, not two: showing BMUX also turns Control Mode on
     * (the blue border), and hiding it turns Control Mode off. That is what the
     * extension icon and Alt+Shift+B do; `detach` toggles the same thing.
     */
    toggle() {
        if (!this.isTop || !this.ui) return;

        this.isActive = !this.isActive;
        this.log(`Toggle: ${this.isActive}`);

        if (this.isActive) {
            this.ui.overlay.classList.remove('hidden');
            // Do not steal focus: keys must reach Control Mode, not a text field.
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
            this.setControlMode(true);
            this.renderLayout();
            return;
        }

        this.clearPaneIndexes();
        this.cancelPrompts();
        this.setControlMode(false);
        this.ui.overlay.classList.add('hidden');
    }

    syncActivePaneFromFocus() {
        if (!this.isTop || !this.ui) return;

        const element = document.activeElement;
        if (!element || element.tagName !== 'IFRAME' || !element.closest) return;

        const pane = element.closest('.bmux-pane');
        if (pane && this.ui.panes.contains(pane)) {
            this.setActivePane(pane);
        }
    }

    /** Remember what the last keys looked like (the `keys` command prints these). */
    recordKey(event, mode) {
        const entry = {
            at: Date.now(),
            key: String(event.key),
            code: String(event.code || ''),
            shift: !!event.shiftKey,
            ctrl: !!event.ctrlKey,
            alt: !!event.altKey,
            meta: !!event.metaKey,
            mode: mode || '',
            binding: ''
        };

        this.keyLog.push(entry);
        while (this.keyLog.length > BMUX_KEY_LOG) this.keyLog.shift();
        return entry;
    }

    /** Recent key events, formatted for the `keys` command. */
    recentKeys(limit) {
        const entries = this.keyLog.slice(-(limit || BMUX_KEY_LOG));
        if (!entries.length) return ['No keys seen yet.'];

        return entries.map((entry, index) => {
            const mods = [
                entry.ctrl ? 'Ctrl' : '',
                entry.shift ? 'Shift' : '',
                entry.alt ? 'Alt' : '',
                entry.meta ? 'Meta' : ''
            ].filter(Boolean).join('+');

            const shape = `${mods ? mods + '+' : ''}${entry.key === ' ' ? 'Space' : entry.key}` +
                (entry.code ? ` [code ${entry.code}]` : '') +
                (entry.mode ? ` · ${entry.mode}` : '');

            return `${index + 1}. ${shape} → ${entry.binding || '(swallowed, no binding)'}`;
        });
    }

    handleKey(e) {
        // If we are in the Top frame and the Command Line is open and focused,
        // handle Enter/Escape here and let every other key through to the input.
        if (this.isTop && this.ui && this.commandLineOpen &&
            document.activeElement === this.ui.commandInput) {
            if (e.key === 'Enter') {
                this.submitCommandLine();
                e.preventDefault(); e.stopPropagation();
            } else if (e.key === 'Escape') {
                this.hideCommandMode();
                e.preventDefault(); e.stopPropagation();
            }
            return;
        }

        // An open prompt owns the keyboard: digits pick a choice, Enter takes the
        // primary one, y / n answer a yes/no prompt, Escape cancels. Typing in a
        // text field (the prompt's own input, the console, a pane input) is never
        // intercepted.
        if (this.hasOpenPrompt() && !this.isTypingTarget(e)) {
            if (this.handlePromptKey(e)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }

        // display-panes picker: while the numbers are on screen, a digit selects
        // that pane and Escape cancels.
        if (this.paneIndexPrompt && !this.isTypingTarget(e)) {
            if (/^[1-9]$/.test(e.key)) {
                e.preventDefault(); e.stopPropagation();
                const panes = this.getPanes();
                const index = Number(e.key) - 1;
                this.clearPaneIndexes();
                if (index < panes.length) this.setActivePane(panes[index]);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation();
                this.clearPaneIndexes();
                return;
            }
        }

        // Highlighted filter boxes are on screen: Escape takes them down before
        // anything else consuming Escape (the `escape` binding below does the same
        // for frames, which cannot see the top frame's filter state).
        if (e.key === 'Escape' && this.hasActiveFilters()) {
            e.preventDefault();
            e.stopPropagation();
            const cleared = this.clearAllFilters();
            this.log(`Cleared ${cleared} filter highlight(s)`);
            return;
        }

        // LEGACY PREFIX (Ctrl+b) comes first: the prefix must work in every mode,
        // including Control Mode, exactly like tmux.
        if (e.ctrlKey && (e.key === 'b' || e.code === 'KeyB')) {
            this.recordKey(e, 'prefix');
            this.prefixPressed = true;
            try {
                chrome.runtime.sendMessage({ command: 'prefix-detected' });
            } catch (error) {
                // background asleep: the prefix still arms locally
            }
            e.preventDefault();
            e.stopPropagation();
            clearTimeout(this.prefixTimeout);
            this.prefixTimeout = setTimeout(() => {
                this.prefixPressed = false;
            }, BMUX_PREFIX_TIMEOUT);
            return;
        }

        if (this.prefixPressed) {
            e.preventDefault();
            e.stopPropagation();
            this.prefixPressed = false;

            const command = bmuxKeyBinding('prefix', e);
            const entry = this.recordKey(e, 'prefix');
            if (command) {
                entry.binding = command;
                this.dispatchLine(command);
            } else {
                this.log(`Unbound key after Ctrl+b: ${e.key}` +
                    (e.code ? ` (code ${e.code})` : '') +
                    (e.shiftKey ? ' with Shift' : ''));
            }
            return;
        }

        // CONTROL MODE LOGIC
        if (this.isControlMode) {
            // Typing in the console or a pane input keeps working in Control Mode
            if (this.isTypingTarget(e)) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            this.log(`Control Key: ${e.key}`);

            const command = bmuxKeyBinding('control', e);
            const entry = this.recordKey(e, 'control');
            if (command) {
                entry.binding = command;
                this.dispatchLine(command);
            } else {
                this.log(`Unbound key: ${e.key}` +
                    (e.code ? ` (code ${e.code})` : '') +
                    (e.shiftKey ? ' with Shift' : ''));
            }
            return;
        }
    }

    /**
     * Run a command line from a key binding. The top frame runs it directly;
     * any other frame relays the line to the background, which sends it back to
     * the top frame as `execute-line`.
     */
    dispatchLine(line) {
        if (!line) return;
        if (this.isTop) {
            this.runLine(line);
            return;
        }
        chrome.runtime.sendMessage({ command: 'relay-line', line: line });
    }

    submitCommandLine() {
        if (!this.ui) return;
        const value = this.ui.commandInput.value;
        this.ui.commandInput.value = '';
        this.hideCommandMode();
        if (value && value.trim()) {
            this.rememberCommand(value);
            this.runLine(value);
        }
    }

    showCommandMode() {
        if (!this.ui) return;
        this.commandLineOpen = true;
        this.ui.commandLine.style.display = 'flex';
        this.ui.commandInput.value = '';
        this.ui.commandInput.focus();
    }

    hideCommandMode() {
        if (!this.ui) return;
        this.commandLineOpen = false;
        this.ui.commandLine.style.display = 'none';
    }

    // --- Command dispatch (the one path every entry point takes) ---

    /**
     * Parse and run one command line. Never throws: a bad command, a bad
     * argument or a throw inside a command comes back as an error string.
     *
     * opts.pane - pane context for pane commands (defaults to the active pane)
     */
    async runCommand(line, opts) {
        const options = opts || {};
        const text = (line == null ? '' : String(line)).trim();
        if (!text) return '';

        if (typeof BMUX_COMMANDS === 'undefined') {
            return 'Error: Command system not loaded';
        }

        const parts = text.split(/\s+/);
        const name = parts[0];
        const args = parts.slice(1);

        if (!bmuxHasOwn(BMUX_COMMANDS, name)) {
            return `Error: Unknown command "${name}". Type "help" for commands.`;
        }

        const pane = options.pane || this.getActivePane();
        const api = {
            client: this,
            pane: pane,
            log: (message) => this.log(message),
            ask: (prompt) => this.ask(pane, prompt),
            askText: (prompt) => this.askText(pane, prompt)
        };

        try {
            const result = await BMUX_COMMANDS[name].execute(api, args);
            return result == null ? '' : String(result);
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            return `Error: ${message}`;
        }
    }

    /**
     * Run one or more commands: `;` separates them, and they run one after
     * another, each awaited, so a prompt raised by one is answered before the
     * next starts. A failing command does not stop the chain.
     */
    async runLine(line) {
        const segments = splitCommandLine(line);
        if (!segments.length) return '';

        if (segments.length === 1) {
            return this.runCommandAndLog(segments[0]);
        }

        const results = [];
        for (let i = 0; i < segments.length; i++) {
            if (this.ui) this.log(`[${i + 1}/${segments.length}] ${segments[i]}`);
            results.push(await this.runCommandAndLog(segments[i]));
        }

        return results.filter((result) => result).join('\n');
    }

    /**
     * Run a line and echo it plus its result to the debug console. Used by the
     * toolbar, the console, the `: ` line and key bindings.
     */
    async runCommandAndLog(line) {
        const text = (line == null ? '' : String(line)).trim();
        if (!text) return '';

        this.log(`> ${text}`);
        const result = await this.runCommand(text);
        if (result) {
            this.log(result);
        }
        return result;
    }

    // --- .bmux scripts: load a file, run it paced, stop it ---

    /** Show or hide the script panel. `focus` (default) moves the caret into it. */
    setScriptPanelOpen(open, focus) {
        const next = !!open;
        this.scriptPanelOpen = next;

        if (this.ui && this.ui.scriptPanel) {
            this.ui.scriptPanel.classList.toggle('bmux-script-hidden', !next);
        }
        if (next && focus !== false && this.ui && this.ui.scriptText) {
            this.ui.scriptText.focus();
        }

        if (!next) this.scriptRunOnLoad = false;
        return next;
    }

    /** Put text in the panel, show it, and remember the name used in log lines. */
    scriptSetText(text, name) {
        const body = text == null ? '' : String(text);
        this.scriptName = name || 'script';

        if (this.ui) {
            if (this.ui.scriptText) this.ui.scriptText.value = body;
            if (this.ui.scriptName) this.ui.scriptName.textContent = String(this.scriptName).toUpperCase();
        }

        this.setScriptPanelOpen(true);
        return body;
    }

    /** The one line under the panel title: what is running, or why it stopped. */
    setScriptProgress(text) {
        this.scriptProgress = text == null ? '' : String(text);

        if (this.ui && this.ui.scriptProgress) {
            this.ui.scriptProgress.textContent = this.scriptProgress || 'ready';
        }
        if (this.ui && this.ui.scriptPanel) {
            this.ui.scriptPanel.classList.toggle('bmux-script-running', !!this.scriptRun);
        }
    }

    /** `script status`: panel, running script, line count. */
    scriptStatus() {
        const lines = this.ui && this.ui.scriptText
            ? bmuxParseScript(this.ui.scriptText.value)
            : { ok: false, error: 'the panel is not built' };

        const loaded = lines.ok
            ? `${lines.commands.length} command(s)`
            : `not runnable (${lines.error})`;
        const running = this.scriptRun
            ? `running "${this.scriptRun.name}" at ${this.scriptRun.index}/${this.scriptRun.total}`
            : 'no script running';

        return [
            `Script panel: ${this.scriptPanelOpen ? 'open' : 'closed'} · ${loaded}`,
            `Runner: ${running}`
        ].join('\n');
    }

    /** Open the file picker for a `.bmux` file; `runNow` starts it on load. */
    scriptLoadFile(runNow) {
        if (!this.ui || !this.ui.scriptFileChoice) return false;

        this.scriptRunOnLoad = !!runNow;
        this.ui.scriptFileChoice.value = '';
        this.ui.scriptFileChoice.click();
        return true;
    }

    /** Read a chosen file into the panel, then run it if `--run` asked for that. */
    async handleScriptFile(event) {
        const input = event && event.target;
        const file = input && input.files && input.files[0];
        if (!file) return '';

        const runNow = !!this.scriptRunOnLoad;
        this.scriptRunOnLoad = false;
        let text = '';
        try {
            text = await this.readFileText(file);
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            this.log(`Script file "${file.name}": Error: ${message}`);
            return `Error: ${message}`;
        }

        this.scriptSetText(text, file.name);
        const parsed = bmuxParseScript(text);

        if (!parsed.ok) {
            this.setScriptProgress(`parse error · ${file.name}`);
            this.log(`Script file "${file.name}": Error: ${parsed.error}`);
            return `Error: ${parsed.error}`;
        }

        this.setScriptProgress(`${parsed.commands.length} command(s) loaded`);
        return runNow
            ? this.runScript(text, { name: file.name })
            : `${parsed.commands.length} command(s) loaded from ${file.name} — Run starts it`;
    }

    /** FileReader for a picked file (falls back to Blob.text where available). */
    readFileText(file) {
        return new Promise((resolve, reject) => {
            if (typeof FileReader === 'undefined' || !file) {
                if (file && typeof file.text === 'function') {
                    file.text().then(resolve, reject);
                    return;
                }
                reject(new Error('Cannot read files here'));
                return;
            }

            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result == null ? '' : reader.result));
            reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
            reader.readAsText(file);
        });
    }

    /** Load the built-in demo into the panel; `runNow` (default) starts it. */
    scriptDemo(runNow) {
        if (typeof BMUX_DEMO_SCRIPT === 'undefined') return 'Error: Script support is not loaded';

        this.scriptSetText(BMUX_DEMO_SCRIPT, 'demo.bmux');
        if (runNow === false) {
            const parsed = bmuxParseScript(BMUX_DEMO_SCRIPT);
            return `Demo loaded into the script panel (${parsed.ok ? parsed.commands.length : 0} commands) — Run starts it`;
        }
        return this.runScript(BMUX_DEMO_SCRIPT, { name: 'demo.bmux' });
    }

    /**
     * Run a `.bmux` script: one command per line, in order, each awaited. A line
     * that fails is logged and the script carries on (shell `;` semantics, same as
     * a chain); `sleep` lines pace the run. Only one script runs at a time, and a
     * script cannot start another — that would make `script stop` a lie.
     */
    async runScript(source, options) {
        const opts = options || {};

        if (typeof bmuxParseScript === 'undefined') return 'Error: Script support is not loaded';
        if (this.scriptRun) {
            return 'Error: a script is already running — "script stop" first';
        }

        const parsed = bmuxParseScript(source);
        if (!parsed.ok) return `Error: ${parsed.error}`;

        const run = {
            name: opts.name || this.scriptName || 'script',
            total: parsed.commands.length,
            index: 0,
            stopped: false
        };
        this.scriptRun = run;
        this.scriptName = run.name;

        if (this.ui && this.ui.scriptName) {
            this.ui.scriptName.textContent = String(run.name).toUpperCase();
        }
        this.log(`Script "${run.name}": ${run.total} command(s)`);
        this.setScriptPanelOpen(true, false);   // visible progress, without stealing focus
        this.setScriptProgress(`starting · ${run.total} command(s)`);

        let ran = 0;
        let failures = 0;
        let stopped = false;

        try {
            for (let i = 0; i < parsed.commands.length; i++) {
                const entry = parsed.commands[i];
                if (run.stopped) break;

                run.index = entry.index;
                const label = `[${entry.index}/${run.total}]`;
                this.setScriptProgress(`${entry.index}/${run.total} · ${entry.text}`);
                this.log(`${label} ${entry.text}`);

                const result = await this.runCommand(entry.text);
                ran++;
                if (/^Error:/.test(result || '')) failures++;
                if (result) this.log(result);
            }
        } finally {
            stopped = run.stopped;
            this.scriptRun = null;
            this.cancelSleep();
        }

        const ratio = `${ran}/${run.total}`;
        const problems = failures ? `, ${failures} command(s) reported an error (see the log)` : '';
        const summary = stopped
            ? `Script "${run.name}": stopped after ${ratio}${problems}`
            : `Script "${run.name}": ran ${ratio} command(s)${problems}`;

        this.setScriptProgress(stopped ? `stopped · ${ratio}` : `finished · ${ratio}`);
        return summary;
    }

    /** Ask the running script to stop after the current command, and cut a sleep short. */
    stopScript() {
        if (!this.scriptRun) {
            const sleeping = !!this.sleepState;
            this.cancelSleep();
            return sleeping ? 'Sleep cancelled' : 'No script is running';
        }

        this.scriptRun.stopped = true;
        this.cancelSleep();
        this.log('Script: stop requested');
        return 'Stopping after the current command';
    }

    /**
     * An awaited, cancellable pause. `stopScript()` ends it early, so `script stop`
     * never has to wait out a `sleep 30`.
     */
    sleepSeconds(seconds) {
        const ms = Math.max(0, Number(seconds) * 1000);
        if (!(ms > 0)) return Promise.resolve(true);

        return new Promise((resolve) => {
            const state = {};

            state.finish = (completed) => {
                if (state.done) return;
                state.done = true;
                clearTimeout(state.timer);
                if (this.sleepState === state) this.sleepState = null;
                resolve(!!completed);
            };

            state.timer = setTimeout(() => state.finish(true), ms);
            this.sleepState = state;
        });
    }

    /** End a pending `sleep` immediately (used by `script stop`). */
    cancelSleep() {
        if (this.sleepState) {
            this.sleepState.finish(false);
            return true;
        }
        return false;
    }

    // --- command line editing: shared history and Tab completion ---

    /** Remember a command in the shared history (consecutive duplicates collapse). */
    rememberCommand(line) {
        const text = (line == null ? '' : String(line)).trim();
        if (!text) return;

        const history = this.commandHistory;
        if (history[history.length - 1] !== text) history.push(text);
        while (history.length > BMUX_HISTORY_LIMIT) history.shift();
    }

    /**
     * Wire Enter, ArrowUp/ArrowDown (history) and Tab (completion) onto a command
     * input. `options.onSubmit(value)` runs the line; `options.report(text)` shows
     * completions or a "no match" note. Without onSubmit, Enter is left to whoever
     * already handles it (the `:` line).
     */
    bindCommandInput(input, options) {
        const opts = options || {};

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                if (!opts.onSubmit) return;

                const value = input.value;
                input.value = '';
                input._bmuxHistory = null;
                event.stopPropagation();

                if (value && value.trim()) {
                    this.rememberCommand(value);
                    opts.onSubmit(value);
                }
                return;
            }

            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                if (this.recallHistory(input, event.key === 'ArrowUp' ? -1 : 1)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

            if (event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                this.completeInput(input, opts.report);
            }
        });

        // Typing (not a programmatic recall) starts a fresh place in history.
        input.addEventListener('input', () => {
            input._bmuxHistory = null;
        });
    }

    /** Walk the shared history. Returns true when the key was used. */
    recallHistory(input, step) {
        const history = this.commandHistory;
        if (!history.length) return false;

        if (!input._bmuxHistory) {
            input._bmuxHistory = { index: history.length, draft: input.value };
        }

        const state = input._bmuxHistory;
        if (state.index >= history.length) state.draft = input.value;

        const next = bmuxClamp(state.index + step, 0, history.length);
        state.index = next;
        input.value = next === history.length ? state.draft : history[next];

        try {
            input.setSelectionRange(input.value.length, input.value.length);
        } catch (e) {
            // some input types do not support selection
        }

        return true;
    }

    /** What could complete the segment of the line before the caret. */
    completionFor(segment) {
        const trailingSpace = /\s$/.test(segment);
        const words = segment.trim().length ? segment.trim().split(/\s+/) : [];
        const current = trailingSpace ? '' : (words.length ? words[words.length - 1] : '');
        const prior = trailingSpace ? words : words.slice(0, -1);
        const head = prior.length ? prior.join(' ') + ' ' : '';

        let pool;
        if (!prior.length) {
            pool = Object.keys(BMUX_COMMANDS);
        } else {
            pool = this.argumentCandidates(prior[0], prior.slice(1));
        }

        const seen = {};
        const candidates = pool
            .filter((candidate) => candidate && candidate.toLowerCase().indexOf(current.toLowerCase()) === 0)
            .filter((candidate) => {
                if (seen[candidate]) return false;
                seen[candidate] = true;
                return true;
            })
            .sort();

        return {
            head: head,
            current: current,
            candidates: candidates,
            common: longestCommonPrefix(candidates)
        };
    }

    /** Argument vocabulary for a command, for Tab after the command name. */
    argumentCandidates(command, args) {
        const ids = this.getPanes().map((pane) => this.getPaneId(pane));
        const numbers = this.getPanes().map((pane, index) => String(index + 1));

        switch (command) {
            case 'focus-pane':
                return ['up', 'down', 'left', 'right'].concat(ids, numbers);
            case 'kill-pane':
            case 'swap-pane':
                return ids.concat(numbers);
            case 'resize-pane':
                return ['-L', '-R', '-U', '-D', '-x', '-Z'];
            case 'select-layout':
                return typeof BMUX_LAYOUT_NAMES !== 'undefined' ? BMUX_LAYOUT_NAMES.slice() : [];
            case 'log':
                return ['toggle', 'on', 'off', 'clear', 'size'];
            case 'control-mode':
                return ['on', 'off', 'toggle'];
            case 'persist':
            case 'inherit':
                return ['on', 'off', 'status'];
            case 'script':
                return ['run', 'file', 'demo', 'open', 'close', 'stop', 'status'];
            case 'select-window':
            case 'kill-window':
                return this.getWindows()
                    .map((record, index) => [String(index + 1), record.name])
                    .reduce((all, pair) => all.concat(pair), []);
            case 'list-windows':
                return ['-j', '--json'];
            case 'cycle-pane':
                return ['next', 'prev'];
            case 'split-window':
                return ['-h', '-v', '-l', '-b', '-d'];
            case 'list-panes':
                return ['-j', '--json'];
            case 'capture-pane':
                return ['-n'];
            case 'delete-layout':
                return ['--all'];
            case 'filter': {
                if (typeof BMUX_FILTER_PRESETS === 'undefined') return [];

                const flags = ['-n', '-y', '-l', '-c', '--in', '--not-in', '--text',
                    '--visible', '--unique', '--replace', '--presets'];
                const presets = Object.keys(BMUX_FILTER_PRESETS);

                // A second word after a preset completes that preset's variants.
                if (args.length === 1) {
                    const preset = BMUX_FILTER_PRESETS[args[0].toLowerCase()];
                    if (preset && preset.variants) {
                        return Object.keys(preset.variants).concat(flags);
                    }
                }

                return presets.concat(flags);
            }
            default:
                return [];
        }
    }

    /** Tab: complete the segment under the caret, or list what could follow. */
    completeInput(input, report) {
        const value = input.value;
        const caret = input.selectionStart == null ? value.length : input.selectionStart;
        const before = value.slice(0, caret);
        const after = value.slice(caret);

        const segment = before.slice(lastSegmentStart(before));
        const result = this.completionFor(segment);

        if (!result.candidates.length) {
            if (report && result.current) report(`No completion for "${result.current}"`);
            return;
        }

        const typed = `${result.head}${result.current}`;
        const tailStart = before.length - typed.length;

        const replaceTail = (text) => {
            input.value = before.slice(0, tailStart) + text + after;
            const caretAt = tailStart + text.length;
            try {
                input.setSelectionRange(caretAt, caretAt);
            } catch (e) {
                // ignore
            }
        };

        if (result.candidates.length === 1) {
            replaceTail(`${result.head}${result.candidates[0]} `);
            return;
        }

        if (result.common.length > result.current.length) {
            replaceTail(`${result.head}${result.common}`);
            return;
        }

        if (report) {
            report(`Completions (${result.candidates.length}): ${result.candidates.join('  ')}`);
        }
    }

    // --- Pane primitives (used by commands.js through api.client) ---

    /** Panes in layout order (reading order of the split tree). */
    // --- toolbar (the top menu, configured from the settings page) ---

    /** The built-in toolbar, used before the saved configuration arrives. */
    defaultToolbar() {
        return [
            { label: 'Split H', command: 'split-window -h' },
            { label: 'Split V', command: 'split-window -v' },
            { label: 'New Window', command: 'new-window' },
            { label: 'Panes', command: 'list-panes' },
            { label: 'Windows', command: 'list-windows' },
            { label: 'Cookies', command: 'list-cookies' },
            { label: 'Storage', command: 'list-storage' },
            { label: 'Forms', command: 'list-forms' },
            { label: 'Outline', command: 'outline' },
            { label: 'Up', command: 'focus-pane up' },
            { label: 'Down', command: 'focus-pane down' },
            { label: 'Left', command: 'focus-pane left' },
            { label: 'Right', command: 'focus-pane right' },
            { label: 'Zoom', command: 'resize-pane -Z' },
            { label: 'Layout', command: 'next-layout' },
            { label: 'Detach', command: 'detach' }
        ];
    }

    /**
     * Keep only buttons whose command exists, so a toolbar edited elsewhere (or a
     * command renamed in a later release) can never render a dead button.
     */
    sanitizeToolbar(entries) {
        if (!Array.isArray(entries)) return null;

        const registry = typeof BMUX_COMMANDS === 'undefined' ? null : BMUX_COMMANDS;
        const cleaned = [];
        const dropped = [];

        entries.forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;

            const label = String(entry.label == null ? '' : entry.label).trim().slice(0, 24);
            const command = String(entry.command == null ? '' : entry.command).trim().slice(0, 120);
            if (!label || !command) return;

            const name = command.split(/\s+/)[0];
            if (registry && !bmuxHasOwn(registry, name)) {
                dropped.push(name);
                return;
            }

            if (cleaned.some((button) => button.label === label && button.command === command)) return;
            cleaned.push({ label: label, command: command });
        });

        if (dropped.length) {
            this.log(`Toolbar: skipped unknown command(s): ${dropped.join(', ')}`);
        }

        return cleaned.length ? cleaned : null;
    }

    /** The extension's own version, when the runtime can tell us. */
    extensionVersion() {
        try {
            const manifest = chrome && chrome.runtime && chrome.runtime.getManifest
                ? chrome.runtime.getManifest()
                : null;
            return manifest && manifest.version ? String(manifest.version) : '';
        } catch (error) {
            return '';
        }
    }

    /** Draw the brand (with its version) and the buttons. */
    renderToolbarBrand() {
        if (!this.ui || !this.ui.toolbarVersion) return '';

        const version = this.extensionVersion();
        this.ui.toolbarVersion.textContent = version ? `v${version}` : '';
        this.ui.toolbarVersion.title = version ? `BMUX ${version}` : '';
        if (this.ui.toolbarVersion.parentNode) {
            this.ui.toolbarVersion.parentNode.title = version
                ? `BMUX ${version} — click the extension icon for the menu`
                : 'BMUX — click the extension icon for the menu';
        }
        return version;
    }

    /** Draw the toolbar from `this.toolbarButtons`. */
    renderToolbar() {
        if (!this.ui || !this.ui.toolbarButtons) return;

        const container = this.ui.toolbarButtons;
        container.textContent = '';

        this.renderToolbarBrand();

        this.toolbarButtons.forEach((entry) => {
            const button = document.createElement('button');
            button.className = 'bmux-btn';
            button.textContent = entry.label;
            button.title = entry.command;
            button.dataset.command = entry.command;
            button.onclick = () => this.runCommandAndLog(entry.command);
            container.appendChild(button);
        });

        const count = this.toolbarButtons.length;
        if (this.ui.toolbar) {
            this.ui.toolbar.title = `${count} button(s) — edit them in the extension menu (Settings)`;
        }
    }

    /** Ask the background for the saved toolbar and draw it. */
    async loadToolbar() {
        const reply = await this.persistRequest({ command: 'toolbar-get' }, 1200);
        const custom = reply && reply.status === 'ok' ? this.sanitizeToolbar(reply.buttons) : null;

        this.toolbarButtons = custom || this.sanitizeToolbar(this.defaultToolbar()) || this.defaultToolbar();
        this.toolbarSource = custom ? (reply.source || 'custom') : 'default';
        this.renderToolbar();
        return this.toolbarButtons;
    }

    // --- windows: several layouts in one tab ---

    /** Every pane in the overlay, across all windows (including hidden ones). */
    allPanes() {
        if (!this.ui || !this.ui.panes) return [];
        return Array.prototype.slice.call(this.ui.panes.querySelectorAll('.bmux-pane'));
    }

    getWindows() {
        return this.windows;
    }

    getActiveWindow() {
        return this.windows[this.activeWindowIndex] || null;
    }

    windowLabel(record) {
        const window = record || this.getActiveWindow();
        if (!window) return 'no window';
        const number = this.windows.indexOf(window) + 1;
        return `${number}:${window.name || number}`;
    }

    /** A window record: its own tree plus the per-window bits of the live state. */
    createWindowRecord(name) {
        const suggested = String(name == null ? '' : name)
            .replace(/[\u0000-\u001f:]/g, '')
            .trim()
            .slice(0, BMUX_MAX_WINDOW_NAME);

        return {
            id: `w${this.nextWindowId++}`,
            name: suggested || String(this.windows.length + 1),
            layout: null,
            zoomedPane: null,
            rootPane: null,
            layoutName: null,
            lastActivePane: null
        };
    }

    /** Copy the live fields into the active window record. */
    stashActiveWindow() {
        const record = this.getActiveWindow();
        if (!record) return false;

        record.layout = this.layout;
        record.zoomedPane = this.zoomedPane;
        record.rootPane = this.rootPane;
        record.layoutName = this.layoutName;
        record.lastActivePane = this.lastActivePane;
        return true;
    }

    /** Load a window record's fields into the live state. */
    unstashWindow(record) {
        this.layout = record.layout;
        this.zoomedPane = record.zoomedPane;
        this.rootPane = record.rootPane;
        this.layoutName = record.layoutName;
        this.lastActivePane = record.lastActivePane;
    }

    /** Hide every pane that does not belong to the active window. */
    applyWindowVisibility() {
        const record = this.getActiveWindow();
        const activeId = record ? record.id : null;

        this.allPanes().forEach((pane) => {
            if (pane.dataset.windowId === activeId) return;   // renderLayout owns those
            pane.style.display = 'none';
        });
    }

    /** Switch windows: stash, swap the live state, re-render. */
    activateWindow(index) {
        const target = this.windows[index];
        if (!target) return { ok: false, message: 'No such window' };
        if (index === this.activeWindowIndex && this.layout) {
            return { ok: true, pane: this.getActivePane(), window: target };
        }

        this.clearPaneIndexes();
        this.stashActiveWindow();
        this.activeWindowIndex = index;
        this.unstashWindow(target);

        this.applyWindowVisibility();
        this.renderLayout();

        let active = this.getActivePane();
        if (!active) {
            active = this.getPanes()[0] || null;
            if (active) this.setActivePane(active);
        }

        return { ok: true, pane: active, window: target };
    }

    cycleWindow(step) {
        if (this.windows.length < 2) return { ok: false, message: 'Only one window' };

        const size = this.windows.length;
        const next = ((this.activeWindowIndex + (step || 1)) % size + size) % size;
        const result = this.activateWindow(next);
        return result.ok ? { ok: true, window: result.window } : result;
    }

    /** `select-window <number|name>`. */
    selectWindow(token) {
        const text = String(token == null ? '' : token).trim();
        if (!text) return { ok: false, message: 'Usage: select-window <number|name>' };

        const number = parseInt(text.replace(/^w/i, ''), 10);
        if (Number.isFinite(number) && String(number) === text.replace(/^w/i, '')) {
            if (number < 1 || number > this.windows.length) {
                return { ok: false, message: `No window ${number} (1-${this.windows.length})` };
            }
            return this.activateWindow(number - 1);
        }

        const index = this.windows.findIndex((record) => record.name === text);
        if (index === -1) return { ok: false, message: `No window named "${text}"` };
        return this.activateWindow(index);
    }

    /** The window that was active before this one (kept as a simple rotation). */
    lastWindow() {
        if (this.windows.length < 2) return { ok: false, message: 'Only one window' };
        const previous = (this.activeWindowIndex - 1 + this.windows.length) % this.windows.length;
        const result = this.activateWindow(previous);
        return result.ok ? { ok: true, window: result.window } : result;
    }

    renameWindow(name) {
        const record = this.getActiveWindow();
        if (!record) return { ok: false, message: 'No window' };

        const clean = String(name == null ? '' : name)
            .replace(/[\u0000-\u001f:]/g, '')
            .trim()
            .slice(0, BMUX_MAX_WINDOW_NAME);
        if (!clean) return { ok: false, message: 'Usage: rename-window <name>' };

        record.name = clean;
        this.refreshStatus();
        this.scheduleSave();
        return { ok: true, window: record, name: clean };
    }

    /** Remove a window and every pane in it. The last window is refused. */
    killWindow(token) {
        if (this.windows.length <= 1) return { ok: false, message: 'Cannot kill the last window' };

        let index = this.activeWindowIndex;
        if (token !== undefined && token !== null && String(token).length) {
            const number = parseInt(String(token), 10);
            if (Number.isFinite(number)) {
                if (number < 1 || number > this.windows.length) {
                    return { ok: false, message: `No window ${number} (1-${this.windows.length})` };
                }
                index = number - 1;
            } else {
                index = this.windows.findIndex((record) => record.name === String(token));
                if (index === -1) return { ok: false, message: `No window named "${token}"` };
            }
        }

        const record = this.windows[index];
        if (!record) return { ok: false, message: 'No such window' };

        this.clearPaneIndexes();

        const doomed = [];
        this.collectPaneRefs(record.layout, doomed);
        doomed.forEach((pane) => this.destroyPane(pane));

        const wasActive = index === this.activeWindowIndex;
        this.windows.splice(index, 1);

        if (wasActive) {
            this.activeWindowIndex = Math.min(index, this.windows.length - 1);
            const next = this.getActiveWindow();
            if (next) this.unstashWindow(next);
            this.applyWindowVisibility();
            this.renderLayout();

            let active = this.getActivePane();
            if (!active) {
                active = this.getPanes()[0] || null;
                if (active) this.setActivePane(active);
            }
        } else {
            if (index < this.activeWindowIndex) this.activeWindowIndex -= 1;
            this.stashActiveWindow();
            this.applyWindowVisibility();
            this.refreshStatus();
        }

        this.scheduleSave();
        return { ok: true, window: record };
    }

    /** Remove a pane element and everything the client tracks for it. */
    destroyPane(pane) {
        if (!pane) return;
        if (pane.dataset) delete pane.dataset.bmuxFrameId;
        this.clearFilter(pane);
        this.cancelPrompt(pane, 'its pane was removed');
        if (this.filters && this.filters.delete) this.filters.delete(pane);
        if (this.prompts && this.prompts.delete) this.prompts.delete(pane);
        if (pane._bmuxFloat && pane._bmuxFloat.parentNode) {
            pane._bmuxFloat.parentNode.removeChild(pane._bmuxFloat);
        }
        delete pane._bmuxFloat;
        if (this.zoomedPane === pane) this.zoomedPane = null;
        if (this.lastActivePane === pane) this.lastActivePane = null;
        pane.remove();
    }

    /** `list-windows [-j]`. */
    listWindows(json) {
        this.stashActiveWindow();

        if (json) {
            return JSON.stringify(this.windows.map((record, index) => ({
                number: index + 1,
                name: record.name,
                panes: this.paneCountOf(record.layout),
                active: index === this.activeWindowIndex
            })), null, 2);
        }

        const rows = this.windows.map((record, index) => [
            String(index + 1),
            record.name,
            String(this.paneCountOf(record.layout)),
            index === this.activeWindowIndex ? 'ACTIVE' : ''
        ]);

        return ['Windows:', this.formatTable(['#', 'name', 'panes', ''], rows)].join('\n');
    }

    paneCountOf(tree) {
        const panes = [];
        this.collectPaneRefs(tree, panes);
        return panes.length;
    }

    // --- cookies: the background holds the permission, the pane gives the URL ---

    /** A pane's URL when it is usable as a cookie origin, else this tab's page. */
    cookieUrlForPane(pane) {
        const target = pane || this.getActivePane();
        const url = target ? this.getPaneUrl(target) : window.location.href;
        return /^https?:/i.test(String(url)) ? String(url) : window.location.href;
    }

    async cookieRequest(message) {
        const reply = await this.persistRequest(message, 3000);
        if (!reply) {
            return { ok: false, error: 'the background did not answer — reload the extension if it predates 0.8.0' };
        }
        if (reply.status !== 'ok') {
            return { ok: false, error: reply.reason || 'the background refused the request' };
        }
        return reply;
    }

    listCookies(filters, url) {
        const target = url || this.cookieUrlForPane();
        return this.cookieRequest({ command: 'cookie-list', url: target, filters: filters || {} })
            .then((reply) => (reply.ok
                ? { ok: true, cookies: reply.cookies || [], url: reply.url || target }
                : reply));
    }

    setCookie(details, url) {
        const target = url || this.cookieUrlForPane();
        return this.cookieRequest({ command: 'cookie-set', url: target, details: details || {} })
            .then((reply) => (reply.ok ? { ok: true, cookie: reply.cookie } : reply));
    }

    removeCookies(name, url) {
        const target = url || this.cookieUrlForPane();
        return this.cookieRequest({ command: 'cookie-remove', url: target, name: name == null ? null : String(name) })
            .then((reply) => (reply.ok
                ? { ok: true, removed: reply.removed || 0, names: reply.names || [] }
                : reply));
    }

    /**
     * Evaluate an expression in a pane's **page** world.
     *
     * MV3 forbids `eval` in a content script, so this asks the frame for its id and
     * has the background run the code with `chrome.scripting.executeScript`. The id
     * is cached on the pane: it does not change while the frame lives.
     */
    async evalInPane(pane, code) {
        if (!pane) return { ok: false, error: 'no pane' };

        let frameId = pane.dataset ? pane.dataset.bmuxFrameId : undefined;

        if (frameId === undefined) {
            const identified = await this.inspectPane(pane, 'frame-id', {}, 1200);
            if (!identified.ok) {
                return { ok: false, error: 'could not identify the pane frame: ' + identified.error };
            }
            frameId = String(identified.result.frameId);
            if (pane.dataset) pane.dataset.bmuxFrameId = frameId;
        }

        const reply = await this.persistRequest({
            command: 'exec-script',
            frameId: Number(frameId),
            code: String(code == null ? '' : code)
        }, 3000);

        if (!reply) return { ok: false, error: 'the background did not answer' };
        if (reply.status !== 'ok') return { ok: false, error: reply.reason || 'the browser refused to run it' };

        return { ok: true, type: reply.type, value: reply.value };
    }

    // --- pane inspection: ask the frame that owns a pane to look at itself ---

    /**
     * Post an inspection request into a pane's frame and resolve with its answer.
     * `content/inspect.js` runs inside every frame and replies to its parent, which
     * is why this works on cross-origin panes: `postMessage` is allowed across
     * origins, `iframe.contentWindow.location` is not.
     */
    inspectPane(pane, kind, args, timeoutMs) {
        const iframe = pane && pane.querySelector ? pane.querySelector('iframe') : null;
        const target = iframe && iframe.contentWindow;
        if (!target) return Promise.resolve({ ok: false, error: 'this pane has no frame' });

        const nonce = `i${++this.inspectNonce}-${Date.now().toString(36)}`;
        const budget = timeoutMs || BMUX_INSPECT_TIMEOUT;

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingInspections.delete(nonce);
                resolve({
                    ok: false,
                    error: `the pane did not answer within ${budget}ms (blocked, sandboxed or still loading)`
                });
            }, budget);

            this.pendingInspections.set(nonce, { resolve: resolve, timer: timer, source: target });

            try {
                target.postMessage({ __bmuxInspect: nonce, kind: kind, args: args || {} }, '*');
            } catch (error) {
                clearTimeout(timer);
                this.pendingInspections.delete(nonce);
                resolve({ ok: false, error: 'could not reach the pane: ' + (error && error.message) });
            }
        });
    }

    /**
     * A pane's frame reports the pointer is inside it: that pane becomes active.
     * Returns true when the message was ours, so the inspection listener can be
     * skipped. Anything from a window we do not own is ignored.
     */
    handlePaneFocus(event) {
        const data = event && event.data;
        if (!data || typeof data !== 'object' || !data.__bmuxPaneFocus) return false;
        if (!this.isTop || !this.ui) return true;

        const panes = this.allPanes();

        for (let i = 0; i < panes.length; i++) {
            const iframe = panes[i].querySelector('iframe');
            if (iframe && iframe.contentWindow === event.source) {
                if (this.getActivePane() !== panes[i]) this.setActivePane(panes[i]);
                return true;
            }
        }

        return true;
    }

    /** Resolve a pending inspection when the pane's frame answers. */
    handleInspectReply(event) {
        const data = event && event.data;
        if (!data || typeof data !== 'object' || !data.__bmuxInspectReply) return false;

        const entry = this.pendingInspections.get(data.__bmuxInspectReply);
        if (!entry) return false;
        if (entry.source && event.source !== entry.source) return false;

        clearTimeout(entry.timer);
        this.pendingInspections.delete(data.__bmuxInspectReply);
        entry.resolve(data.ok
            ? { ok: true, result: data.result }
            : { ok: false, error: data.error || 'the pane reported an error' });
        return true;
    }

    /**
     * Render an inspection result for the console: aligned columns for a list of
     * records, one per line for plain values, pretty JSON for a lone object.
     */
    formatValue(value) {
        if (value == null) return 'null';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);

        if (Array.isArray(value)) {
            if (!value.length) return '(empty)';
            const objects = value.every((item) => item && typeof item === 'object' && !Array.isArray(item));
            if (!objects) return value.map((item) => this.formatValue(item)).join('\n');

            const columns = [];
            value.forEach((item) => {
                Object.keys(item).forEach((key) => {
                    if (columns.indexOf(key) === -1) columns.push(key);
                });
            });
            const rows = value.map((item) => columns.map((key) => {
                const cell = item[key];
                if (cell === undefined) return '';
                if (typeof cell === 'object') return JSON.stringify(cell);
                return String(cell);
            }));
            return this.formatTable(columns, rows);
        }

        // Plain object: pretty JSON, which stays copy-pasteable.
        try {
            return JSON.stringify(value, null, 2);
        } catch (error) {
            return String(value);
        }
    }

    /**
     * A box-drawn table: `┌─┬─┐`, a header row, one rule, then the rows.
     * Numeric columns are right-aligned, long cells are ellipsed to fit
     * `BMUX_TABLE_MAX_WIDTH`, and every row lines up in a monospace console.
     */
    formatTable(columns, rows, options) {
        const opts = options || {};
        const names = columns.map((column) => String(column));
        const limit = opts.maxWidth || BMUX_TABLE_MAX_WIDTH;

        const cells = rows.map((row) => names.map((unused, index) => String(
            row[index] === undefined || row[index] === null ? '' : row[index]
        )));

        const numeric = names.map((unused, index) => cells.length > 0 && cells.every((row) => {
            const cell = row[index].trim();
            return cell === '' || /^-?\d+(\.\d+)?$/.test(cell);
        }) && cells.some((row) => row[index].trim() !== ''));

        const widths = names.map((name, index) => Math.max(
            name.length,
            cells.reduce((max, row) => Math.max(max, row[index].length), 0)
        ));

        // Fit the box into the terminal: shrink the widest columns first.
        const overhead = 3 * names.length + 1;
        let total = widths.reduce((sum, width) => sum + width, 0) + overhead;

        while (total > limit) {
            const widest = widths.indexOf(Math.max.apply(null, widths));
            if (widths[widest] <= 6) break;
            widths[widest] -= 1;
            total -= 1;
        }

        const fit = (text, width) => (text.length <= width
            ? text
            : (width <= 1 ? text.slice(0, width) : text.slice(0, width - 1) + '…'));

        const pad = (text, width, right) => {
            const clipped = fit(text, width);
            return right ? clipped.padStart(width, ' ') : clipped.padEnd(width, ' ');
        };

        const rule = (left, middle, right) => left +
            widths.map((width) => '─'.repeat(width + 2)).join(middle) + right;

        const line = (row, align) => '│ ' +
            widths.map((width, index) => pad(row === null ? names[index] : row[index], width,
                row === null ? false : align[index])).join(' │ ') + ' │';

        const out = [rule('┌', '┬', '┐'), line(null), rule('├', '┼', '┤')];
        cells.forEach((row) => out.push(line(row, numeric)));
        out.push(rule('└', '┴', '┘'));
        return out.join('\n');
    }

    getPanes() {
        if (!this.ui) return [];
        const panes = [];
        this.collectPaneRefs(this.layout, panes);

        if (!panes.length) {
            const record = this.getActiveWindow();
            const activeId = record ? record.id : null;
            return this.allPanes().filter((pane) => !activeId || pane.dataset.windowId === activeId);
        }
        return panes;
    }

    collectPaneRefs(node, out) {
        if (!node) return;
        if (node.kind === 'leaf') {
            out.push(node.pane);
            return;
        }
        this.collectPaneRefs(node.first, out);
        this.collectPaneRefs(node.second, out);
    }

    getActivePane() {
        const panes = this.getPanes();
        for (let i = 0; i < panes.length; i++) {
            if (panes[i].classList.contains('active')) return panes[i];
        }
        return panes.length ? panes[0] : null;
    }

    /** Id assigned once at creation (%1, %2, ...) and never reused. */
    getPaneId(pane) {
        if (!pane || !pane.dataset) return '?';
        return pane.dataset.paneId || '?';
    }

    /** Reading-order position, 1-based. Follows the layout, not the DOM. */
    getPaneNumber(pane) {
        return this.getPanes().indexOf(pane) + 1;
    }

    getPaneUrl(pane) {
        const iframe = pane && pane.querySelector ? pane.querySelector('iframe') : null;
        if (!iframe) return '(no iframe)';

        try {
            const live = iframe.contentWindow && iframe.contentWindow.location
                ? iframe.contentWindow.location.href
                : '';
            if (live && live !== 'about:blank') return live;
        } catch (e) {
            // Cross-origin: fall through to the src attribute
        }

        return iframe.getAttribute('src') || iframe.src || '(unknown)';
    }

    /** Custom title set with rename-pane, or a title derived from the page. */
    getPaneTitle(pane) {
        if (!pane) return '';

        const custom = pane.dataset ? pane.dataset.paneTitle : '';
        if (custom) return custom;

        const iframe = pane.querySelector ? pane.querySelector('iframe') : null;
        if (iframe) {
            try {
                const title = iframe.contentDocument && iframe.contentDocument.title;
                if (title && title.trim()) return title.trim();
            } catch (e) {
                // Cross-origin: fall back to the URL
            }
        }

        const url = this.getPaneUrl(pane);
        try {
            const parsed = new URL(url);
            if (!parsed.hostname) return url;
            const path = parsed.pathname === '/' ? '' : parsed.pathname;
            return `${parsed.hostname}${path}`;
        } catch (e) {
            return url;
        }
    }

    renamePane(pane, title) {
        if (!pane || !pane.dataset) return;
        const clean = String(title == null ? '' : title).trim();
        if (!clean || clean === '-') {
            delete pane.dataset.paneTitle;
        } else {
            pane.dataset.paneTitle = clean;
        }
        this.refreshPaneTitles();
        this.scheduleSave();
    }

    /** Fractional rect of a pane within #bmux-panes ({ x, y, w, h } in 0..1). */
    getPaneRect(pane) {
        if (!this.rects || !this.rects.has(pane)) this.renderLayout();
        return this.rects.get(pane) || { x: 0, y: 0, w: 1, h: 1 };
    }

    getPaneSizeLabel(pane) {
        const rect = this.getPaneRect(pane);
        return `${Math.round(rect.w * 100)}%x${Math.round(rect.h * 100)}%`;
    }

    isZoomed(pane) {
        return !!this.zoomedPane && this.zoomedPane === pane;
    }

    /**
     * Find a pane by token: either its id ("%2") or its number ("2").
     * Returns null for anything else, including nonsense like "constructor".
     */
    findPaneByToken(token) {
        const raw = (token == null ? '' : String(token)).trim();
        if (!raw) return null;

        const panes = this.getPanes();

        for (let i = 0; i < panes.length; i++) {
            if (this.getPaneId(panes[i]) === raw) return panes[i];
        }

        if (/^\d+$/.test(raw)) {
            const index = parseInt(raw, 10) - 1;
            if (index >= 0 && index < panes.length) return panes[index];
        }

        return null;
    }

    setActivePane(pane) {
        if (!pane) return;

        const previous = this.getActivePane();
        if (previous && previous !== pane) this.lastActivePane = previous;

        this.getPanes().forEach((candidate) => candidate.classList.remove('active'));
        pane.classList.add('active');

        this.refreshPaneBadges();
        this.refreshStatus();
        this.scheduleSave();
    }

    lastPane() {
        const panes = this.getPanes();
        const target = this.lastActivePane;
        if (!target || panes.indexOf(target) === -1 || target === this.getActivePane()) {
            return { ok: false, message: 'No previous pane' };
        }
        this.setActivePane(target);
        return { ok: true, pane: target };
    }

    cyclePane(step) {
        const panes = this.getPanes();
        if (panes.length < 2) return { ok: false, message: 'Only one pane' };

        const current = panes.indexOf(this.getActivePane());
        const next = ((current + (step || 1)) % panes.length + panes.length) % panes.length;
        this.setActivePane(panes[next]);
        return { ok: true, pane: panes[next] };
    }

    /** Footer badges: "[number id]". */
    refreshPaneBadges() {
        this.getPanes().forEach((pane) => {
            const badge = pane.querySelector('.bmux-pane-badge');
            if (badge) {
                badge.textContent = `[${this.getPaneNumber(pane)} ${this.getPaneId(pane)}]`;
                badge.title = `${this.getPaneTitle(pane)} — ${this.getPaneUrl(pane)} (${this.getPaneSizeLabel(pane)})`;
            }
        });
    }

    /** Keep the per-pane maximize glyph in step with the zoom state. */
    refreshPaneControls() {
        this.getPanes().forEach((pane) => {
            const maxButton = pane.querySelector('.bmux-pane-max-btn');
            if (maxButton) {
                const zoomed = this.isZoomed(pane);
                maxButton.textContent = zoomed ? '\u2921' : '\u2922';
                maxButton.title = zoomed
                    ? 'Restore the layout (Shift+z)'
                    : 'Maximize this pane (Shift+z)';
                maxButton.classList.toggle('bmux-pane-max-btn-active', zoomed);
            }

            const detachButton = pane.querySelector('.bmux-pane-detach-btn');
            if (detachButton) {
                const floating = this.isPaneConsoleFloating(pane);
                detachButton.title = floating
                    ? 'Dock this console back into the pane (log attach)'
                    : 'Detach this console into its own window (log detach)';
                detachButton.classList.toggle('bmux-pane-detach-btn-active', floating);
            }
        });
    }

    refreshPaneTitles() {
        this.getPanes().forEach((pane) => {
            const title = pane.querySelector('.bmux-pane-title');
            if (title) title.textContent = this.getPaneTitle(pane);
        });
    }

    refreshStatus() {
        if (!this.ui || !this.ui.statusRight) return;

        const total = this.windows.length;
        const label = total ? this.windowLabel() : 'no window';

        if (this.ui.statusWindow) {
            this.ui.statusWindow.textContent = total > 1 ? `${label} (${this.activeWindowIndex + 1}/${total})` : label;
            this.ui.statusWindow.classList.toggle('bmux-status-window-many', total > 1);
            this.ui.statusWindow.title = total > 1
                ? `Window ${this.activeWindowIndex + 1} of ${total} — click or press n for the next one`
                : 'This tab has one window (new-window creates another)';
        }

        const pane = this.getActivePane();
        if (!pane) {
            this.ui.statusRight.textContent = 'Ready';
            return;
        }

        const zoom = this.isZoomed(pane) ? ' · ZOOM' : '';
        this.ui.statusRight.textContent =
            `pane ${this.getPaneNumber(pane)} ${this.getPaneId(pane)} · ${this.getPaneSizeLabel(pane)}${zoom}`;
    }

    /** Pixel rect of a pane, as rendered. */
    paneRect(pane) {
        const rect = pane.getBoundingClientRect ? pane.getBoundingClientRect() : null;
        const left = rect ? (rect.left || 0) : 0;
        const top = rect ? (rect.top || 0) : 0;
        const width = rect ? (rect.width || 0) : (pane.offsetWidth || 0);
        const height = rect ? (rect.height || 0) : (pane.offsetHeight || 0);

        return {
            left: left,
            top: top,
            width: width,
            height: height,
            cx: left + width / 2,
            cy: top + height / 2
        };
    }

    /**
     * Move focus one pane in `direction`, wrapping at the edge.
     * Returns { ok, pane, wrapped } or { ok: false, message }.
     */
    focusDirection(direction) {
        const panes = this.getPanes();

        if (!panes.length) {
            return { ok: false, message: 'No panes to focus' };
        }
        if (panes.length === 1) {
            return { ok: false, message: 'Only one pane: split first' };
        }

        // A zoomed pane hides the others; any directional move unzooms first so
        // the geometry it reads is the real layout.
        if (this.zoomedPane) {
            this.zoomedPane = null;
            this.renderLayout();
        }

        const current = this.getActivePane();
        if (!current) {
            return { ok: false, message: 'No panes to focus' };
        }

        const picked = pickPaneInDirection(panes, current, direction, (pane) => this.paneRect(pane));
        if (!picked) {
            return { ok: false, message: `Cannot move focus ${direction}` };
        }

        this.setActivePane(picked.pane);

        return { ok: true, pane: picked.pane, wrapped: picked.wrapped, direction: direction };
    }

    // --- Layout tree operations ---

    findLeaf(pane) {
        const walk = (node) => {
            if (!node) return null;
            if (node.kind === 'leaf') return node.pane === pane ? node : null;
            return walk(node.first) || walk(node.second);
        };
        return walk(this.layout);
    }

    findParent(node) {
        const walk = (current) => {
            if (!current || current.kind === 'leaf') return null;
            if (current.first === node) return { parent: current, side: 'first' };
            if (current.second === node) return { parent: current, side: 'second' };
            return walk(current.first) || walk(current.second);
        };
        return walk(this.layout);
    }

    replaceNode(oldNode, newNode) {
        const parent = this.findParent(oldNode);
        if (!parent) {
            this.layout = newNode;
            return;
        }
        parent.parent[parent.side] = newNode;
    }

    /** Path from the root to the leaf holding `pane`, with the side taken. */
    pathToPane(pane) {
        const walk = (node, trail) => {
            if (!node) return null;
            if (node.kind === 'leaf') return node.pane === pane ? trail : null;
            return walk(node.first, trail.concat([{ node: node, side: 'first' }])) ||
                walk(node.second, trail.concat([{ node: node, side: 'second' }]));
        };
        return walk(this.layout, []);
    }

    computeLayout() {
        const leaves = [];
        const splits = [];

        const walk = (node, rect) => {
            if (!node) return;
            if (node.kind === 'leaf') {
                leaves.push({ pane: node.pane, rect: rect });
                return;
            }
            splits.push({ node: node, rect: rect });

            if (node.direction === 'row') {
                const firstWidth = rect.w * node.ratio;
                walk(node.first, { x: rect.x, y: rect.y, w: firstWidth, h: rect.h });
                walk(node.second, { x: rect.x + firstWidth, y: rect.y, w: rect.w - firstWidth, h: rect.h });
            } else {
                const firstHeight = rect.h * node.ratio;
                walk(node.first, { x: rect.x, y: rect.y, w: rect.w, h: firstHeight });
                walk(node.second, { x: rect.x, y: rect.y + firstHeight, w: rect.w, h: rect.h - firstHeight });
            }
        };

        walk(this.layout, { x: 0, y: 0, w: 1, h: 1 });
        return { leaves: leaves, splits: splits };
    }

    applyPaneRect(pane, rect) {
        const g = BMUX_GUTTER;
        pane.style.left = `calc(${(rect.x * 100).toFixed(4)}% + ${g}px)`;
        pane.style.top = `calc(${(rect.y * 100).toFixed(4)}% + ${g}px)`;
        pane.style.width = `calc(${(rect.w * 100).toFixed(4)}% - ${2 * g}px)`;
        pane.style.height = `calc(${(rect.h * 100).toFixed(4)}% - ${2 * g}px)`;
    }

    /**
     * Recompute rectangles from the tree and apply them. Every structural change
     * lands here, so this is where the layout is persisted from — except during a
     * restore, or when the caller says the render is cosmetic (a window resize).
     */
    renderLayout(opts) {
        const options = opts || {};
        if (!this.ui) return;

        const { leaves, splits } = this.computeLayout();
        const zoomed = this.zoomedPane;

        this.rects = new Map();

        leaves.forEach((entry) => {
            const pane = entry.pane;
            this.rects.set(pane, entry.rect);

            if (zoomed && pane !== zoomed) {
                pane.style.display = 'none';
                return;
            }

            pane.style.display = '';
            const rect = zoomed === pane ? { x: 0, y: 0, w: 1, h: 1 } : entry.rect;
            this.applyPaneRect(pane, rect);
        });

        // While zoomed, the split boundaries belong to hidden panes: no handles.
        this.renderHandles(zoomed ? [] : splits);

        this.refreshPaneBadges();
        this.refreshPaneTitles();
        this.refreshPaneControls();
        this.refreshStatus();
        this.refreshPromptStack();

        if (options.persist !== false) this.scheduleSave();
    }

    /** One draggable handle per split boundary, positioned from the last render. */
    renderHandles(splits) {
        if (!this.ui || !this.ui.handles) return;

        const layer = this.ui.handles;

        while (this.handles.length < splits.length) {
            const handle = document.createElement('div');
            handle.className = 'bmux-split-handle';
            layer.appendChild(handle);
            this.handles.push(handle);
        }

        this.handles.forEach((handle, index) => {
            const entry = splits[index];

            if (!entry) {
                handle.style.display = 'none';
                handle._split = null;
                return;
            }

            const node = entry.node;
            const rect = entry.rect;
            const horizontal = node.direction === 'row';
            const g = BMUX_GUTTER;

            handle.style.display = '';
            handle._split = node;
            handle._rect = rect;
            handle.title = 'Drag to resize, double-click to reset';

            if (horizontal) {
                const boundary = rect.x + rect.w * node.ratio;
                handle.className = 'bmux-split-handle bmux-handle-column';
                handle.style.left = `calc(${(boundary * 100).toFixed(4)}% - 4px)`;
                handle.style.top = `calc(${(rect.y * 100).toFixed(4)}% + ${g}px)`;
                handle.style.width = '8px';
                handle.style.height = `calc(${(rect.h * 100).toFixed(4)}% - ${2 * g}px)`;
            } else {
                const boundary = rect.y + rect.h * node.ratio;
                handle.className = 'bmux-split-handle bmux-handle-row';
                handle.style.left = `calc(${(rect.x * 100).toFixed(4)}% + ${g}px)`;
                handle.style.top = `calc(${(boundary * 100).toFixed(4)}% - 4px)`;
                handle.style.width = `calc(${(rect.w * 100).toFixed(4)}% - ${2 * g}px)`;
                handle.style.height = '8px';
            }

            handle.onmousedown = (event) => this.startHandleDrag(event, handle);
            handle.ondblclick = () => this.resetHandle(handle);
        });
    }

    /**
     * Drag a split boundary with the mouse. Ratios are fractions of the split's
     * own rect, so the pixel delta is converted with the rect's rendered size.
     */
    startHandleDrag(event, handle) {
        const node = handle._split;
        if (!node) return;

        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const horizontal = node.direction === 'row';
        const bounds = this.ui.panes.getBoundingClientRect();
        const span = horizontal ? bounds.width * handle._rect.w : bounds.height * handle._rect.h;
        if (!span) return;

        const startPosition = horizontal ? event.clientX : event.clientY;
        const startRatio = node.ratio;
        const previousCursor = document.body.style.cursor;
        document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';

        // Mouse events over a pane's iframe never reach this document, so the
        // overlay is covered while dragging: the pointer stays over the shield.
        const shield = this.ui.dragShield;
        if (shield) {
            shield.className = horizontal ? 'active column' : 'active row';
        }

        const move = (moveEvent) => {
            const delta = ((horizontal ? moveEvent.clientX : moveEvent.clientY) - startPosition) / span;
            node.ratio = bmuxClamp(startRatio + delta, BMUX_MIN_RESIZE, BMUX_MAX_RESIZE);
            this.layoutName = null;
            this.renderLayout();
        };

        const up = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', up, true);
            document.body.style.cursor = previousCursor;
            if (shield) shield.className = '';
            this.log(`Resize: ${node.direction} ratio ${node.ratio.toFixed(2)}`);
        };

        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
    }

    resetHandle(handle) {
        const node = handle._split;
        if (!node) return;
        node.ratio = 0.5;
        this.layoutName = null;
        this.renderLayout();
        this.log('Resize: reset to 50/50');
    }

    /** Set one pane's share of its parent split, as a fraction (0..1). */
    setPaneSize(pane, share) {
        const trail = this.pathToPane(pane);
        if (!trail || !trail.length) {
            return { ok: false, message: 'Only one pane: nothing to resize' };
        }

        const immediate = trail[trail.length - 1];
        const clamped = bmuxClamp(share, BMUX_MIN_RESIZE, BMUX_MAX_RESIZE);
        immediate.node.ratio = immediate.side === 'first' ? clamped : 1 - clamped;
        this.layoutName = null;
        this.renderLayout();
        return { ok: true, share: clamped };
    }

    /**
     * Move the split boundary next to `pane` in `direction` by `percent` points of
     * the overlay. The boundary moves in the pressed direction whether the pane
     * sits before or after it, so every direction does something on every pane
     * that has a split on that axis.
     *
     * Returns { ok, ratio } or { ok: false, message }.
     */
    resizePane(pane, direction, percent) {
        if (this.zoomedPane) {
            return { ok: false, message: 'Pane is zoomed: resize-pane -Z first' };
        }

        const horizontal = direction === 'left' || direction === 'right';
        const trail = this.pathToPane(pane);

        if (!trail) return { ok: false, message: 'No such pane' };

        let boundary = null;
        for (let i = trail.length - 1; i >= 0; i--) {
            if (trail[i].node.direction === (horizontal ? 'row' : 'column')) {
                boundary = trail[i].node;
                break;
            }
        }

        if (!boundary) {
            return {
                ok: false,
                message: horizontal
                    ? 'No side-by-side split to resize (the layout has no vertical boundary)'
                    : 'No stacked split to resize (the layout has no horizontal boundary)'
            };
        }

        const delta = Math.abs(percent) / 100;
        const sign = (direction === 'right' || direction === 'down') ? 1 : -1;
        boundary.ratio = bmuxClamp(boundary.ratio + sign * delta, BMUX_MIN_RESIZE, BMUX_MAX_RESIZE);
        this.layoutName = null;
        this.renderLayout();

        return { ok: true, ratio: boundary.ratio };
    }

    zoomPane(pane) {
        const target = pane || this.getActivePane();
        if (!target) return { ok: false, message: 'No pane to zoom' };

        if (this.zoomedPane === target) {
            this.zoomedPane = null;
            this.renderLayout();
            return { ok: true, zoomed: false };
        }

        this.zoomedPane = target;
        this.setActivePane(target);
        this.renderLayout();
        return { ok: true, zoomed: true };
    }

    /** Rebuild the tree as one of the presets, keeping the same panes. */
    applyLayout(name) {
        const panes = this.getPanes();
        if (!panes.length) return { ok: false, message: 'No panes' };

        let tree;
        switch (name) {
            case 'even-horizontal':
                tree = bmuxEvenSplitPanes(panes, 'row');
                break;
            case 'even-vertical':
                tree = bmuxEvenSplitPanes(panes, 'column');
                break;
            case 'main-vertical':
                tree = bmuxMainSplit(panes, 'row', 0.6);
                break;
            case 'main-horizontal':
                tree = bmuxMainSplit(panes, 'column', 0.6);
                break;
            case 'tiled':
                tree = bmuxTiled(panes);
                break;
            default:
                return { ok: false, message: `Unknown layout "${name}". Try: ${BMUX_LAYOUTS.join(', ')}` };
        }

        this.layout = tree;
        this.layoutName = name;
        this.zoomedPane = null;
        this.renderLayout();
        return { ok: true, layout: name };
    }

    nextLayout() {
        const current = BMUX_LAYOUTS.indexOf(this.layoutName);
        const next = BMUX_LAYOUTS[(current + 1) % BMUX_LAYOUTS.length];
        return this.applyLayout(next);
    }

    /** Swap two panes' positions. Panes keep running: only the tree changes. */
    swapPanes(first, second) {
        if (!first || !second || first === second) {
            return { ok: false, message: 'Give two different panes to swap' };
        }

        const firstLeaf = this.findLeaf(first);
        const secondLeaf = this.findLeaf(second);
        if (!firstLeaf || !secondLeaf) return { ok: false, message: 'No such pane' };

        firstLeaf.pane = second;
        secondLeaf.pane = first;
        this.layoutName = null;
        this.renderLayout();
        return { ok: true };
    }

    /** Move every pane one position along the layout order. */
    rotatePanes(reverse) {
        const panes = this.getPanes();
        if (panes.length < 2) return { ok: false, message: 'Only one pane' };

        const leaves = [];
        const collect = (node) => {
            if (!node) return;
            if (node.kind === 'leaf') {
                leaves.push(node);
                return;
            }
            collect(node.first);
            collect(node.second);
        };
        collect(this.layout);

        const offset = reverse ? 1 : -1;
        leaves.forEach((leaf, index) => {
            // forwards: slot j shows the pane that was at slot j-1
            const source = ((index + offset) % panes.length + panes.length) % panes.length;
            leaf.pane = panes[source];
        });

        this.layoutName = null;
        this.renderLayout();
        return { ok: true };
    }

    // --- filter highlights ---

    hasActiveFilters() {
        return this.filters.size > 0;
    }

    /** Name a matched element for the status line and command output. */
    describeElement(element) {
        return bmuxDescribeElement(element);
    }

    /** Filter an existing element list with a predicate bound to a pane document. */
    filterElements(pane, elements, test) {
        if (typeof test !== 'function') return (elements || []).slice();

        let doc = null;
        try {
            const iframe = pane.querySelector('iframe');
            doc = iframe ? (iframe.contentDocument || iframe.contentWindow.document) : null;
        } catch (e) {
            doc = null;
        }
        if (!doc) return [];

        const view = doc.defaultView || window;
        return (elements || []).filter((element) => {
            try {
                return !!test(element, doc, view);
            } catch (e) {
                return false;
            }
        });
    }

    /** Footer status segment: "FILTER: <selector> - <element>". */
    setPaneStatus(pane, text, mode) {
        const element = pane && pane.querySelector ? pane.querySelector('.bmux-pane-status') : null;
        if (!element) return;

        element.textContent = text || '';
        element.classList.toggle('bmux-pane-status-filtering', mode === 'filtering');
        element.classList.toggle('bmux-pane-status-hovering', mode === 'hovering');
    }

    /**
     * Query a same-origin pane for `selector`, then optionally narrow with a
     * `test(element, doc, view)` predicate (used by the filter presets, which
     * need real predicates for things like same-origin links).
     *
     * Returns { ok, doc, iframe, elements, truncated } or { ok: false, message }.
     */
    collectFilterMatches(pane, selector, test) {
        if (!this.ui || !pane) return { ok: false, message: 'No pane to filter' };

        const iframe = pane.querySelector('iframe');
        if (!iframe) return { ok: false, message: 'No iframe found in pane' };

        let doc = null;
        try {
            doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        } catch (e) {
            doc = null; // cross-origin
        }

        if (!doc || !doc.documentElement) {
            return {
                ok: false,
                message: `Cross-origin content: cannot highlight inside ${this.getPaneUrl(pane)}`
            };
        }

        let elements;
        try {
            elements = Array.prototype.slice.call(doc.querySelectorAll(selector));
        } catch (e) {
            return { ok: false, message: `Invalid selector "${selector}"` };
        }

        const truncated = elements.length > BMUX_FILTER_SCAN_MAX;
        if (truncated) elements = elements.slice(0, BMUX_FILTER_SCAN_MAX);

        if (typeof test === 'function') {
            const view = doc.defaultView || window;
            elements = elements.filter((element) => {
                try {
                    return !!test(element, doc, view);
                } catch (e) {
                    return false;
                }
            });
        }

        return { ok: true, doc: doc, iframe: iframe, elements: elements, truncated: truncated };
    }

    /**
     * Box every element matching `selector` inside a same-origin pane, and follow
     * the pointer with that pane's status line.
     *
     * A filter is a list of parts (`{ selector, test, uniqueBy }`). With
     * options.add the new part is appended to the parts already on that pane, so
     * `filter img; filter a` boxes both. options.elements draws an explicit set
     * (a refinement round) while keeping the parts for the mutation refresh.
     *
     * The boxes live in the pane's own document, positioned in document
     * coordinates, so they scroll with the page and cannot be disturbed by the
     * overlay. They are removed by clearFilter (Esc, `filter -c`, navigation).
     *
     * Returns { ok, matched, shown, truncated } or { ok: false, message }.
     */
    filterPane(pane, selector, opts) {
        const options = opts || {};

        if (!this.ui || !pane) return { ok: false, message: 'No pane to filter' };

        let doc = null;
        try {
            const iframe = pane.querySelector('iframe');
            doc = iframe ? (iframe.contentDocument || iframe.contentWindow.document) : null;
        } catch (e) {
            doc = null; // cross-origin
        }

        if (!doc || !doc.documentElement) {
            return {
                ok: false,
                message: `Cross-origin content: cannot highlight inside ${this.getPaneUrl(pane)}`
            };
        }

        const newParts = options.parts || [{
            selector: selector,
            test: options.test || null,
            uniqueBy: options.uniqueBy || null
        }];

        let parts = newParts;
        if (options.add && this.filters.has(pane)) {
            parts = this.filters.get(pane).parts.concat(newParts);
        }

        let matched;
        let truncated = false;

        if (Array.isArray(options.elements)) {
            matched = options.elements.slice();
        } else {
            matched = [];
            const seen = new Set();

            for (let i = 0; i < parts.length; i++) {
                const collected = this.collectFilterMatches(pane, parts[i].selector, parts[i].test);
                if (!collected.ok) return { ok: false, message: collected.message };
                if (collected.truncated) truncated = true;

                this.uniqueElements(collected.elements, parts[i].uniqueBy).forEach((element) => {
                    if (seen.has(element)) return;
                    seen.add(element);
                    matched.push(element);
                });
            }
        }

        this.clearFilter(pane);

        const max = Math.max(1, Math.min(
            parseInt(options.max, 10) || BMUX_FILTER_MAX,
            BMUX_FILTER_MAX_HARD
        ));

        const layer = doc.createElement('div');
        layer.setAttribute('data-bmux-filter-layer', '');

        const style = doc.createElement('style');
        style.setAttribute('data-bmux-filter-layer', '');
        style.textContent = BMUX_FILTER_CSS;
        layer.appendChild(style);

        doc.documentElement.appendChild(layer);

        const state = {
            selector: parts.map((part) => part.selector).join(', '),
            label: options.label || selector,
            test: options.test || null,
            uniqueBy: options.uniqueBy || null,
            parts: parts,
            max: max,
            doc: doc,
            iframe: pane.querySelector('iframe'),
            layer: layer,
            boxes: [],
            elements: [],
            indexByElement: new Map(),
            total: 0,
            onMove: null,
            onLeave: null,
            onKey: null,
            observer: null,
            refreshTimer: null
        };
        this.filters.set(pane, state);

        const result = this.redrawFilterBoxes(pane, state, matched);

        const hoverIndex = (target) => {
            let node = target;
            while (node) {
                if (state.indexByElement.has(node)) return state.indexByElement.get(node);
                node = node.parentElement;
            }
            return -1;
        };

        state.onMove = (event) => {
            const index = hoverIndex(event.target);

            state.boxes.forEach((entry, position) => {
                entry.box.classList.toggle('bmux-filter-hover', position === index);
            });

            if (index === -1) {
                this.setPaneStatus(pane,
                    `FILTER: ${state.label} · ${state.elements.length} match(es)`, 'filtering');
            } else {
                this.setPaneStatus(pane,
                    `FILTER: ${state.label} - ${bmuxDescribeElement(state.elements[index])} · ` +
                    `${index + 1}/${state.elements.length}`, 'hovering');
            }
        };

        state.onLeave = () => {
            state.boxes.forEach((entry) => entry.box.classList.remove('bmux-filter-hover'));
            this.setPaneStatus(pane,
                `FILTER: ${state.label} · ${state.elements.length} match(es)`, 'filtering');
        };

        // A key pressed with the focus inside the pane document never reaches the
        // top frame's key handler, so Escape is caught here as well — unless a
        // prompt owns the keyboard at that moment.
        state.onKey = (event) => {
            if (event.key !== 'Escape' || this.hasOpenPrompt(pane)) return;
            event.preventDefault();
            event.stopPropagation();
            const cleared = this.clearAllFilters();
            this.log(`Cleared ${cleared} filter highlight(s)`);
        };

        doc.addEventListener('mousemove', state.onMove, true);
        doc.addEventListener('mouseleave', state.onLeave, true);
        doc.addEventListener('keydown', state.onKey, true);

        // Keep the boxes honest when the page changes underneath them.
        const view = doc.defaultView;
        if (view && typeof view.MutationObserver === 'function' && doc.body) {
            state.observer = new view.MutationObserver(() => {
                if (state.refreshTimer) return;
                state.refreshTimer = setTimeout(() => {
                    state.refreshTimer = null;
                    this.refreshFilter(pane);
                }, BMUX_FILTER_REFRESH_DELAY);
            });
            state.observer.observe(doc.body, { childList: true, subtree: true, attributes: true });
        }

        state.onLeave();

        return { ok: true, matched: matched.length, shown: result.shown, truncated: truncated };
    }

    // --- prompts: ask the user something, by click or by key ---

    hasOpenPrompt(pane) {
        if (pane) return this.prompts.has(pane);
        return this.prompts.size > 0;
    }

    /**
     * Ask a question in a floating card above the pane's footer and resolve when
     * it is answered, cancelled, replaced or timed out.
     *
     * options: { question, details, choices: [{ id, label, primary }],
     *            input: { placeholder }, timeout }
     *
     * Resolves { choice, text, cancelled }. `choice` is the chosen id, or null.
     */
    ask(pane, options) {
        const prompt = options || {};
        const target = pane || this.getActivePane();

        return new Promise((resolve) => {
            if (!this.ui || !target) {
                resolve({ choice: null, text: '', cancelled: true });
                return;
            }

            this.cancelPrompt(target, 'replaced by a newer prompt');

            const state = {
                pane: target,
                question: prompt.question || 'Continue?',
                details: prompt.details || '',
                choices: (prompt.choices || []).slice(0, BMUX_PROMPT_MAX_KEYS),
                wantsInput: !!prompt.input,
                inputPlaceholder: prompt.input && prompt.input.placeholder ? prompt.input.placeholder : '',
                resolve: resolve,
                card: null,
                input: null,
                doc: null,
                onKey: null,
                onResize: null,
                timer: null
            };

            const card = document.createElement('div');
            card.className = 'bmux-prompt';
            card.setAttribute('role', 'dialog');
            card.setAttribute('aria-live', 'polite');

            const question = document.createElement('div');
            question.className = 'bmux-prompt-question';
            question.textContent = state.question;
            card.appendChild(question);

            if (state.details) {
                const details = document.createElement('div');
                details.className = 'bmux-prompt-details';
                details.textContent = state.details;
                card.appendChild(details);
            }

            if (state.choices.length) {
                const row = document.createElement('div');
                row.className = 'bmux-prompt-choices';

                state.choices.forEach((choice, index) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'bmux-prompt-btn' + (choice.primary ? ' primary' : '');
                    button.dataset.choice = choice.id;
                    button.textContent = choice.label;

                    const key = document.createElement('kbd');
                    key.textContent = String(index + 1);
                    button.appendChild(key);

                    button.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.resolvePrompt(target, choice.id);
                    });

                    row.appendChild(button);
                });

                card.appendChild(row);
            }

            if (state.wantsInput) {
                const row = document.createElement('div');
                row.className = 'bmux-prompt-input-row';

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'bmux-prompt-input';
                input.placeholder = state.inputPlaceholder;

                const submit = document.createElement('button');
                submit.type = 'button';
                submit.className = 'bmux-prompt-btn primary';
                submit.textContent = 'OK';

                const send = (event) => {
                    if (event) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                    this.resolvePrompt(target, 'text', input.value);
                };

                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') send(event);
                    else if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        this.resolvePrompt(target, null);
                    }
                });
                submit.addEventListener('click', send);

                row.appendChild(input);
                row.appendChild(submit);
                card.appendChild(row);

                state.input = input;
            }

            this.ui.overlay.appendChild(card);
            state.card = card;
            this.prompts.set(target, state);

            this.positionPrompt(state);

            state.onResize = () => this.positionPrompt(state);
            window.addEventListener('resize', state.onResize);

            // Keys pressed with the focus inside the pane never reach the top
            // frame, so the prompt listens on the pane's document too.
            try {
                state.doc = target.querySelector('iframe') ? target.querySelector('iframe').contentDocument : null;
            } catch (e) {
                state.doc = null;
            }

            if (state.doc) {
                state.onKey = (event) => {
                    if (!this.handlePromptKey(event)) return;
                    event.preventDefault();
                    event.stopPropagation();
                };
                try {
                    state.doc.addEventListener('keydown', state.onKey, true);
                } catch (e) {
                    state.onKey = null;
                }
            }

            const timeout = prompt.timeout === undefined ? BMUX_PROMPT_TIMEOUT : prompt.timeout;
            if (timeout > 0 && !state.wantsInput) {
                state.timer = setTimeout(() => {
                    this.cancelPrompt(target, 'timed out');
                }, timeout);
            }

            if (state.input) {
                state.input.focus();
            }

            this.refreshPromptStack();
        });
    }

    /** Ask for a line of text. Resolves { text, cancelled }. */
    askText(pane, options) {
        const prompt = options || {};
        return this.ask(pane, {
            question: prompt.question || 'Value?',
            details: prompt.details || '',
            input: { placeholder: prompt.placeholder || 'type a value and press Enter' },
            choices: [{ id: 'cancel', label: 'Cancel' }],
            timeout: 0
        }).then((answer) => ({
            text: answer.choice === 'text' ? String(answer.text || '').trim() : '',
            cancelled: answer.cancelled || answer.choice !== 'text'
        }));
    }

    /** Answer the open prompt for a pane with a choice id. */
    resolvePrompt(pane, choiceId, text) {
        const state = this.prompts.get(pane);
        if (!state) return false;

        this.prompts.delete(pane);
        if (state.timer) clearTimeout(state.timer);
        if (state.onResize) window.removeEventListener('resize', state.onResize);

        if (state.onKey && state.doc) {
            try {
                state.doc.removeEventListener('keydown', state.onKey, true);
            } catch (e) {
                // the pane document may already be gone
            }
        }

        if (state.card && state.card.parentNode) state.card.parentNode.removeChild(state.card);

        state.resolve({
            choice: choiceId == null ? null : choiceId,
            text: text == null ? '' : String(text),
            cancelled: choiceId == null
        });

        this.refreshPromptStack();
        return true;
    }

    /** Drop a pane's open prompt (kill, navigation, reset, replacement). */
    cancelPrompt(pane, reason) {
        if (!this.prompts.has(pane)) return false;
        if (reason) this.log(`Prompt cancelled: ${reason}`);
        return this.resolvePrompt(pane, null);
    }

    cancelPrompts(pane) {
        if (pane) return this.cancelPrompt(pane, 'pane went away');
        Array.from(this.prompts.keys()).forEach((target) => this.cancelPrompt(target, 'reset'));
        return true;
    }

    /** Answer whichever prompt is open (used by yes / no). */
    answerOpenPrompt(choiceId, pane) {
        let target = null;

        if (pane && this.prompts.has(pane)) {
            target = pane;
        } else {
            const open = Array.from(this.prompts.keys());
            if (!open.length) return { ok: false, message: 'Nothing to confirm' };
            if (open.length > 1) return { ok: false, message: 'More than one prompt is open: answer it on its pane' };
            target = open[0];
        }

        const state = this.prompts.get(target);
        const wanted = state.choices.some((choice) => choice.id === choiceId)
            ? choiceId
            : (state.choices.find((choice) => choice.primary) || state.choices[0] || {}).id;

        this.resolvePrompt(target, wanted);
        return { ok: true, choice: wanted };
    }

    /** Keyboard handling shared by the top frame and the pane documents. */
    handlePromptKey(event) {
        const pane = this.findPromptPaneForEvent(event);
        if (!pane) return false;

        const state = this.prompts.get(pane);
        if (!state) return false;

        if (event.key === 'Escape') {
            this.resolvePrompt(pane, null);
            return true;
        }

        const primary = state.choices.find((choice) => choice.primary) || state.choices[0];

        if (event.key === 'Enter') {
            if (state.wantsInput && document.activeElement === state.input) return false;
            if (primary) {
                this.resolvePrompt(pane, primary.id);
                return true;
            }
            return false;
        }

        if (/^[1-9]$/.test(event.key)) {
            const choice = state.choices[Number(event.key) - 1];
            if (choice) {
                this.resolvePrompt(pane, choice.id);
                return true;
            }
            return false;
        }

        const letter = String(event.key || '').toLowerCase();
        if (letter === 'y' || letter === 'n') {
            const wanted = letter === 'y' ? 'yes' : 'no';
            const choice = state.choices.find((entry) => entry.id === wanted);
            if (choice) {
                this.resolvePrompt(pane, choice.id);
                return true;
            }
            if (letter === 'y' && primary) {
                this.resolvePrompt(pane, primary.id);
                return true;
            }
        }

        return false;
    }

    /** Which pane's prompt a key event belongs to (top frame, or a pane doc). */
    findPromptPaneForEvent(event) {
        if (!this.prompts.size) return null;

        // One open prompt: it owns the keys.
        if (this.prompts.size === 1) return this.prompts.keys().next().value;

        // Several: resolve by which document the key came from.
        const doc = event && event.target && event.target.ownerDocument
            ? event.target.ownerDocument
            : (event && event.view ? event.view.document : null);

        const panes = Array.from(this.prompts.keys());
        for (let i = 0; i < panes.length; i++) {
            const iframe = panes[i].querySelector('iframe');
            try {
                if (iframe && doc && iframe.contentDocument === doc) return panes[i];
            } catch (e) {
                // cross-origin pane: cannot compare documents
            }
        }

        return null;
    }

    /** Anchor a prompt card just above its pane's footer. */
    positionPrompt(state) {
        if (!state || !state.card) return;

        const pane = state.pane;
        const card = state.card;
        const paneRect = pane.getBoundingClientRect();
        const footer = pane.querySelector('.bmux-pane-footer');
        const footerRect = footer ? footer.getBoundingClientRect() : paneRect;

        const width = Math.max(220, Math.min(paneRect.width - 16, 560));
        const left = Math.max(8, paneRect.left + 8);
        const bottom = Math.max(8, window.innerHeight - footerRect.top + 8);

        card.style.width = `${Math.round(width)}px`;
        card.style.left = `${Math.round(left)}px`;
        card.style.bottom = `${Math.round(bottom)}px`;
    }

    refreshPromptStack() {
        Array.from(this.prompts.values()).forEach((state) => this.positionPrompt(state));
    }

    /** Keep the first element per de-dupe key (`href`, `src` or the text). */
    uniqueElements(elements, uniqueBy) {
        if (!uniqueBy) return elements;

        const seen = new Set();
        const kept = [];

        elements.forEach((element) => {
            let key = '';
            try {
                if (uniqueBy === 'src') {
                    key = element.getAttribute ? (element.getAttribute('src') || '') : '';
                } else if (uniqueBy === 'text') {
                    key = (element.textContent || '').trim().replace(/\s+/g, ' ');
                } else {
                    key = element.getAttribute ? (element.getAttribute('href') || '') : '';
                }
            } catch (e) {
                key = '';
            }

            if (!key) {
                kept.push(element);
                return;
            }
            if (seen.has(key)) return;
            seen.add(key);
            kept.push(element);
        });

        return kept;
    }

    /** Draw (or re-draw) one box per match, capped by the filter's max. */
    redrawFilterBoxes(pane, state, matched) {
        const doc = state.doc;
        const view = doc.defaultView || window;

        state.boxes.forEach((entry) => entry.box.remove());
        state.boxes = [];
        state.indexByElement = new Map();

        const shown = matched.slice(0, state.max);
        const scrollX = view.scrollX || doc.documentElement.scrollLeft || 0;
        const scrollY = view.scrollY || doc.documentElement.scrollTop || 0;

        state.elements = shown;
        state.total = matched.length;

        shown.forEach((element, index) => {
            state.indexByElement.set(element, index);

            const rect = element.getBoundingClientRect();
            const box = doc.createElement('div');
            box.setAttribute('data-bmux-filter', String(index + 1));
            box.style.left = `${Math.round(rect.left + scrollX)}px`;
            box.style.top = `${Math.round(rect.top + scrollY)}px`;
            box.style.width = `${Math.max(1, Math.round(rect.width))}px`;
            box.style.height = `${Math.max(1, Math.round(rect.height))}px`;

            const label = doc.createElement('span');
            label.className = 'bmux-filter-index';
            label.textContent = String(index + 1);
            box.appendChild(label);

            state.layer.appendChild(box);
            state.boxes.push({ element: element, box: box });
        });

        return { matched: matched.length, shown: shown.length };
    }

    /**
     * Re-query every part and redraw, for pages that change while filtered.
     * Refinement rounds narrow the drawn set without changing the parts, so a
     * refresh re-broadens the boxes to the selector set.
     */
    refreshFilter(pane) {
        const state = this.filters.get(pane);
        if (!state) return null;

        const doc = state.doc;
        if (!doc || !doc.documentElement || !doc.documentElement.contains(state.layer)) {
            this.clearFilter(pane);
            return null;
        }

        const merged = [];
        const seen = new Set();

        for (let i = 0; i < state.parts.length; i++) {
            const collected = this.collectFilterMatches(pane, state.parts[i].selector, state.parts[i].test);
            if (!collected.ok || collected.doc !== doc) {
                this.clearFilter(pane);
                return null;
            }

            this.uniqueElements(collected.elements, state.parts[i].uniqueBy).forEach((element) => {
                if (seen.has(element)) return;
                seen.add(element);
                merged.push(element);
            });
        }

        const result = this.redrawFilterBoxes(pane, state, merged);
        this.setPaneStatus(pane,
            `FILTER: ${state.label} · ${state.elements.length} match(es)`, 'filtering');
        return result;
    }

    clearFilter(pane) {
        const state = this.filters.get(pane);
        if (!state) return false;

        try {
            if (state.refreshTimer) clearTimeout(state.refreshTimer);
            if (state.observer) state.observer.disconnect();
            if (state.onMove && state.doc) state.doc.removeEventListener('mousemove', state.onMove, true);
            if (state.onLeave && state.doc) state.doc.removeEventListener('mouseleave', state.onLeave, true);
            if (state.onKey && state.doc) state.doc.removeEventListener('keydown', state.onKey, true);
            if (state.layer && state.layer.parentNode) state.layer.parentNode.removeChild(state.layer);
        } catch (e) {
            // The document may already be gone (navigation, pane removal).
        }

        this.filters.delete(pane);
        this.setPaneStatus(pane, '', null);
        return true;
    }

    /** Clear one pane's highlight, or every highlight when no pane is given. */
    clearFilters(pane) {
        if (pane) return this.clearFilter(pane) ? 1 : 0;
        return this.clearAllFilters();
    }

    clearAllFilters() {
        let cleared = 0;
        Array.from(this.filters.keys()).forEach((target) => {
            if (this.clearFilter(target)) cleared++;
        });
        return cleared;
    }

    // --- detached (floating) pane console ---

    isPaneConsoleFloating(pane) {
        return !!(pane && pane.dataset && pane.dataset.consoleFloating === '1');
    }

    /**
     * Move a pane's console out into its own movable window, or dock it back into
     * the pane footer. The same DOM panel is moved, so the scrollback, the history
     * and the input listeners survive the trip.
     */
    setPaneConsoleFloating(pane, floating) {
        if (!this.ui || !this.ui.floating || !pane) return false;

        const wantFloat = !!floating;
        if (wantFloat === this.isPaneConsoleFloating(pane)) return wantFloat;

        const output = this.paneConsole(pane);
        if (!output) return false;

        if (!wantFloat) {
            const footer = pane.querySelector('.bmux-pane-footer');
            if (footer && output.parentNode !== footer) footer.appendChild(output);

            if (pane._bmuxFloat && pane._bmuxFloat.parentNode) {
                pane._bmuxFloat.parentNode.removeChild(pane._bmuxFloat);
            }
            delete pane._bmuxFloat;
            delete pane.dataset.consoleFloating;

            this.refreshPaneControls();
            this.scheduleSave();
            return false;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'bmux-floating-console';

        const header = document.createElement('div');
        header.className = 'bmux-floating-header';

        const title = document.createElement('span');
        title.className = 'bmux-floating-title';
        title.textContent = `console · pane ${this.getPaneNumber(pane)} ${this.getPaneId(pane)}`;

        const dock = document.createElement('button');
        dock.type = 'button';
        dock.className = 'bmux-floating-close';
        dock.textContent = '\u29C9 dock';
        dock.title = 'Dock this console back into its pane (log attach)';

        header.appendChild(title);
        header.appendChild(dock);
        wrapper.appendChild(header);
        wrapper.appendChild(output);

        const grip = document.createElement('div');
        grip.className = 'bmux-floating-grip';
        grip.title = 'Drag to resize this console';
        wrapper.appendChild(grip);

        const bottom = document.createElement('div');
        bottom.className = 'bmux-floating-bottom';
        wrapper.appendChild(bottom);

        this.ui.floating.appendChild(wrapper);
        pane._bmuxFloat = wrapper;
        pane.dataset.consoleFloating = '1';

        this.setPaneConsoleOpen(pane, true);

        const paneRect = pane.getBoundingClientRect();
        const cascade = Math.max(0, this.ui.floating.childElementCount - 1) * 22;
        wrapper.style.left = `${Math.round(bmuxClamp(paneRect.left + 28 + cascade, 0, Math.max(0, window.innerWidth - 470)))}px`;
        wrapper.style.top = `${Math.round(bmuxClamp(paneRect.top + 44 + cascade, 0, Math.max(0, window.innerHeight - 300)))}px`;

        dock.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.setPaneConsoleFloating(pane, false);
        });
        header.addEventListener('mousedown', (event) => this.startFloatingDrag(event, wrapper));
        this.makeResizable(wrapper, grip);
        this.makeResizable(wrapper, bottom, { axis: 'y' });

        this.refreshPaneControls();
        this.scheduleSave();
        return true;
    }

    togglePaneConsoleFloating(pane) {
        return this.setPaneConsoleFloating(pane, !this.isPaneConsoleFloating(pane));
    }

    /** Drag a floating console around by its header. */
    startFloatingDrag(event, wrapper) {
        if (event.button !== undefined && event.button !== 0) return;
        if (event.target && event.target.classList && event.target.classList.contains('bmux-floating-close')) return;

        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startY = event.clientY;
        const startLeft = wrapper.offsetLeft;
        const startTop = wrapper.offsetTop;

        const shield = this.ui ? this.ui.dragShield : null;
        if (shield) shield.className = 'active';

        const move = (moveEvent) => {
            wrapper.style.left = `${Math.round(bmuxClamp(startLeft + (moveEvent.clientX - startX), 0, Math.max(0, window.innerWidth - 80)))}px`;
            wrapper.style.top = `${Math.round(bmuxClamp(startTop + (moveEvent.clientY - startY), 0, Math.max(0, window.innerHeight - 40)))}px`;
        };

        const up = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', up, true);
            if (shield) shield.className = '';
            this.scheduleSave();
        };

        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
    }

    /** Verbose diagnostics for the `info` command. */
    infoReport(section) {
        const wanted = String(section || 'all').toLowerCase();
        const lines = [];

        if (wanted === 'all' || wanted === 'layout') {
            const describe = (node, depth) => {
                if (!node) return '(no layout)';
                const indent = '  '.repeat(depth);
                if (node.kind === 'leaf') {
                    return `${indent}leaf ${this.getPaneId(node.pane)} ${this.getPaneUrl(node.pane)}`;
                }
                return [
                    `${indent}split ${node.direction} ratio ${Number(node.ratio).toFixed(2)}`,
                    describe(node.first, depth + 1),
                    describe(node.second, depth + 1)
                ].join('\n');
            };
            lines.push('== layout ==', describe(this.layout, 0));
        }

        if (wanted === 'all' || wanted === 'panes') {
            lines.push('== panes ==');
            this.getPanes().forEach((pane) => {
                lines.push(`${this.getPaneNumber(pane)} ${this.getPaneId(pane)} · ${this.getPaneSizeLabel(pane)}` +
                    `${this.isZoomed(pane) ? ' · zoomed' : ''}` +
                    `${this.isPaneConsoleFloating(pane) ? ' · console floating' :
                        (this.isPaneConsoleOpen(pane) ? ' · console open' : '')}` +
                    ` · ${this.getPaneTitle(pane)}`);
            });
        }

        if (wanted === 'all' || wanted === 'keys') {
            lines.push('== keys ==', ...this.recentKeys(10));
        }

        if (wanted === 'all' || wanted === 'state') {
            lines.push('== state ==', ...[
                `theme: ${this.theme}`,
                `verbose: ${this.verbose ? 'on' : 'off'}`,
                `debug window: ${this.debugOpen ? 'open' : 'hidden'}`,
                `auto-restore: ${this.persistEnabled ? 'on' : 'off'} (layout from ${this.restoredFrom})`,
                `control mode: ${this.isControlMode ? 'on' : 'off'} · active: ${this.isActive ? 'yes' : 'no'}`,
                `windows: ${this.windows.length} (active ${this.windows.length ? this.windowLabel() : 'none'}) · ` +
                    `panes here: ${this.getPanes().length} · panes total: ${this.allPanes().length}`,
                `zoomed: ${this.zoomedPane ? this.getPaneId(this.zoomedPane) : 'no'}`,
                `filters: ${this.filters.size} · prompts: ${this.prompts.size} · history: ${this.commandHistory.length}`
            ]);
        }

        return lines.join('\n');
    }

    // --- display-panes ---

    displayPanes() {
        this.clearPaneIndexes();

        const panes = this.getPanes();
        if (!panes.length) return { ok: false, message: 'No panes' };

        this.paneIndexPrompt = true;
        panes.forEach((pane, index) => {
            const badge = document.createElement('div');
            badge.className = 'bmux-pane-index';
            badge.textContent = String(index + 1);
            pane.appendChild(badge);
        });

        this.paneIndexTimer = setTimeout(() => this.clearPaneIndexes(), BMUX_PANE_INDEX_TIMEOUT);
        return { ok: true, panes: panes.length };
    }

    clearPaneIndexes() {
        this.paneIndexPrompt = false;
        if (this.paneIndexTimer) {
            clearTimeout(this.paneIndexTimer);
            this.paneIndexTimer = null;
        }
        if (this.ui) {
            Array.prototype.slice.call(this.ui.panes.querySelectorAll('.bmux-pane-index'))
                .forEach((element) => element.remove());
        }
    }

    // --- Splitting, killing, layout lifecycle ---

    /**
     * Split the active pane.
     * opts: {
     *   direction: 'horizontal' | 'vertical',
     *   size: fraction for the new pane (0.1..0.9, default 0.5),
     *   before: put the new pane first (left/top),
     *   keepFocus: leave focus on the pane being split,
     *   url: URL for the new pane (default: clone of the active pane)
     * }
     */
    splitWindow(direction, opts) {
        const options = opts || {};
        if (!this.ui) return { ok: false, message: 'Overlay not ready' };

        const target = this.getActivePane();
        if (!target) {
            if (!this.windows.length) this.ensureFirstWindow();
            return { ok: false, message: 'No pane to split' };
        }

        const cloneUrl = options.url || this.cloneUrlOf(target);
        const newPane = this.createPaneElement(cloneUrl);
        this.ui.panes.appendChild(newPane);

        const leaf = this.findLeaf(target);
        if (!leaf) return { ok: false, message: 'No pane to split' };

        const treeDirection = (direction === 'vertical' || direction === 'column' || direction === 'v')
            ? 'column'
            : 'row';
        const share = bmuxClamp(options.size == null ? 0.5 : options.size, BMUX_MIN_SHARE, BMUX_MAX_SHARE);

        const newLeaf = bmuxLeaf(newPane);
        const splitNode = {
            kind: 'split',
            direction: treeDirection,
            ratio: share,
            first: options.before ? newLeaf : leaf,
            second: options.before ? leaf : newLeaf
        };

        this.replaceNode(leaf, splitNode);
        this.layoutName = null;
        this.zoomedPane = null;

        this.setActivePane(options.keepFocus ? target : newPane);
        this.renderLayout();

        return { ok: true, pane: newPane };
    }

    cloneUrlOf(pane) {
        const iframe = pane.querySelector('iframe');
        if (!iframe) return window.location.href;

        try {
            return iframe.src || iframe.contentWindow.location.href;
        } catch (e) {
            return iframe.getAttribute('src') || window.location.href;
        }
    }

    /** Remove a pane and give its space back to the sibling. */
    killPane(pane) {
        const panes = this.getPanes();
        if (panes.length <= 1) {
            return { ok: false, message: 'Cannot kill the last pane' };
        }

        const target = pane || this.getActivePane();
        const leaf = this.findLeaf(target);
        if (!leaf) return { ok: false, message: 'No such pane' };

        const parent = this.findParent(leaf);
        if (!parent) return { ok: false, message: 'Cannot kill the last pane' };

        const sibling = parent.parent.first === leaf ? parent.parent.second : parent.parent.first;
        const siblingPane = this.firstPaneOf(sibling);
        const wasActive = this.getActivePane() === target;

        this.clearPaneIndexes();
        this.clearFilter(target);
        this.cancelPrompt(target, 'its pane was killed');
        if (target._bmuxFloat && target._bmuxFloat.parentNode) {
            target._bmuxFloat.parentNode.removeChild(target._bmuxFloat);
        }
        delete target._bmuxFloat;
        if (this.zoomedPane === target) this.zoomedPane = null;
        if (this.lastActivePane === target) this.lastActivePane = null;

        // Promote the sibling into the parent's place.
        this.replaceNode(parent.parent, sibling);
        target.remove();

        this.layoutName = null;

        if (this.rootPane === target) this.rootPane = siblingPane;

        if (wasActive && siblingPane) {
            this.setActivePane(siblingPane);
        }
        this.renderLayout();

        return { ok: true, pane: siblingPane };
    }

    firstPaneOf(node) {
        let cursor = node;
        while (cursor && cursor.kind === 'split') cursor = cursor.first;
        return cursor ? cursor.pane : null;
    }

    /** Create a window with one pane on the current page and switch to it. */
    newWindow(name) {
        if (!this.ui) return { ok: false, message: 'Overlay not ready' };
        if (this.windows.length >= BMUX_MAX_WINDOWS) {
            return { ok: false, message: `At most ${BMUX_MAX_WINDOWS} windows per tab` };
        }

        this.clearPaneIndexes();
        this.stashActiveWindow();

        const record = this.createWindowRecord(name);
        this.windows.push(record);
        this.activeWindowIndex = this.windows.length - 1;

        const pane = this.createPaneElement(window.location.href);
        this.ui.panes.appendChild(pane);

        this.layout = bmuxLeaf(pane);
        this.rootPane = pane;
        this.zoomedPane = null;
        this.layoutName = null;
        this.lastActivePane = null;

        this.setActivePane(pane);
        this.applyWindowVisibility();
        this.renderLayout();

        return { ok: true, pane: pane, window: record };
    }

    /** Reset THIS window to a single pane showing the current page. */
    resetLayout() {
        this.clearPaneIndexes();
        this.clearAllFilters();
        this.cancelPrompts();
        if (this.ui && this.ui.floating) this.ui.floating.textContent = '';
        this.zoomedPane = null;
        this.layoutName = null;
        this.lastActivePane = null;
        this.rects = new Map();

        this.getPanes().forEach((pane) => this.destroyPane(pane));

        const pane = this.createPaneElement(window.location.href);
        this.ui.panes.appendChild(pane);
        this.layout = bmuxLeaf(pane);
        this.rootPane = pane;

        this.setActivePane(pane);
        this.applyWindowVisibility();
        this.renderLayout();
    }

    /** First window of a fresh overlay (no snapshot): one pane on this page. */
    ensureFirstWindow() {
        if (!this.windows.length) {
            const record = this.createWindowRecord('1');
            this.windows.push(record);
            this.activeWindowIndex = 0;
        }
        this.resetLayout();
        this.stashActiveWindow();
        return this.getActiveWindow();
    }

    createPaneElement(url) {
        const pane = document.createElement('div');
        pane.className = 'bmux-pane';

        // Ids are assigned once and never reused; numbers follow the layout.
        pane.dataset.paneId = `%${this.nextPaneId++}`;

        // Which window owns this pane: hiding a window is one display:none.
        const owner = this.getActiveWindow();
        if (owner) pane.dataset.windowId = owner.id;

        // Clicking anywhere on the pane makes it the active pane. Clicks that land
        // inside the iframe itself are caught by the window blur sync instead.
        pane.addEventListener('mousedown', () => this.setActivePane(pane));

        // Iframe
        const iframe = document.createElement('iframe');
        iframe.src = url || window.location.href;
        pane.appendChild(iframe);

        // Footer with title, command input and badge
        const footer = document.createElement('div');
        footer.className = 'bmux-pane-footer';

        const cmdContainer = document.createElement('div');
        cmdContainer.className = 'bmux-pane-cmd-container';

        const prompt = document.createElement('span');
        prompt.className = 'bmux-pane-cmd-prompt';
        prompt.textContent = '>';

        const input = document.createElement('input');
        input.className = 'bmux-pane-cmd-input';
        input.type = 'text';
        input.placeholder = 'Type "help" for commands';

        const title = document.createElement('span');
        title.className = 'bmux-pane-title';
        title.textContent = '';

        const status = document.createElement('span');
        status.className = 'bmux-pane-status';

        // Console toggle: the pane's own scrollback stays available until it is
        // closed, and can be reopened from here (or with `log toggle`).
        const consoleButton = document.createElement('button');
        consoleButton.className = 'bmux-pane-console-btn';
        consoleButton.type = 'button';
        consoleButton.textContent = '\u25B8';
        consoleButton.title = "Show this pane's console (log toggle)";

        // Detach the console into its own movable window, or dock it again.
        const detachButton = document.createElement('button');
        detachButton.className = 'bmux-pane-detach-btn';
        detachButton.type = 'button';
        detachButton.textContent = '\u29C9';
        detachButton.title = 'Detach this console into its own window (log detach)';

        // Per-pane maximize/restore: the on-screen form of Ctrl+b, Shift+z.
        const maxButton = document.createElement('button');
        maxButton.className = 'bmux-pane-max-btn';
        maxButton.type = 'button';
        maxButton.textContent = '\u2922';
        maxButton.title = 'Maximize this pane (Shift+z)';

        const badge = document.createElement('span');
        badge.className = 'bmux-pane-badge';
        badge.title = 'Pane number and id (focus-pane <number|%id>)';

        cmdContainer.appendChild(prompt);
        cmdContainer.appendChild(input);
        cmdContainer.appendChild(title);
        cmdContainer.appendChild(status);
        cmdContainer.appendChild(consoleButton);
        cmdContainer.appendChild(detachButton);
        cmdContainer.appendChild(maxButton);
        cmdContainer.appendChild(badge);

        // Console panel: a drag grip on its top edge, then the scrollback log.
        const output = document.createElement('div');
        output.className = 'bmux-pane-output';

        const grip = document.createElement('div');
        grip.className = 'bmux-pane-output-grip';
        grip.title = 'Drag to resize this console; double-click to reset';

        const outputLog = document.createElement('div');
        outputLog.className = 'bmux-pane-output-log';

        output.appendChild(grip);
        output.appendChild(outputLog);

        footer.appendChild(cmdContainer);
        footer.appendChild(output);
        pane.appendChild(footer);

        consoleButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.togglePaneConsole(pane);
        });

        maxButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.runCommand('resize-pane -Z', { pane: pane }).then((result) => {
                if (result) this.log(result);
            });
        });

        detachButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.togglePaneConsoleFloating(pane);
        });

        grip.addEventListener('mousedown', (event) => this.startConsoleResize(event, pane));
        grip.addEventListener('dblclick', () => this.setPaneConsoleHeight(pane, BMUX_CONSOLE_HEIGHT));

        // The page title can become known only after the iframe loads (same-origin).
        // A load also means the document was replaced, so any filter overlay
        // pointing into the old one is gone.
        iframe.addEventListener('load', () => {
            this.refreshPaneTitles();
            if (this.filters.has(pane)) this.clearFilter(pane);
            this.cancelPrompt(pane, 'the pane navigated');
        });

        // Bind the pane command input: history, completion and Enter.
        this.bindCommandInput(input, {
            onSubmit: (cmdText) => this.runPaneCommand(pane, cmdText),
            report: (text) => {
                this.appendPaneOutput(pane, text, 'result');
                this.setPaneConsoleOpen(pane, true);
            }
        });

        return pane;
    }

    /**
     * Run a command typed into a pane's input. The command line and its result are
     * appended to that pane's scrollback, and the console is opened and left open
     * (it used to auto-collapse after five seconds, with no way back).
     */
    async runPaneCommand(pane, cmdText) {
        const segments = splitCommandLine(cmdText);
        if (!segments.length) return '';

        this.setPaneConsoleOpen(pane, true);

        const results = [];
        for (let i = 0; i < segments.length; i++) {
            this.appendPaneOutput(pane, `> ${segments[i]}`, 'command');
            const result = await this.runCommand(segments[i], { pane: pane });
            if (result) this.appendPaneOutput(pane, result, 'result');
            results.push(result);
        }

        return results.filter((result) => result).join('\n');
    }

    // --- pane console (the scrollback under each pane's input) ---

    /** The pane's console panel, wherever it currently lives (footer or float). */
    paneConsole(pane) {
        if (!pane || !pane.querySelector) return null;

        const inline = pane.querySelector('.bmux-pane-output');
        if (inline) return inline;

        return pane._bmuxFloat ? pane._bmuxFloat.querySelector('.bmux-pane-output') : null;
    }

    isPaneConsoleOpen(pane) {
        return !!(pane && pane.dataset && pane.dataset.consoleOpen === '1');
    }

    setPaneConsoleOpen(pane, open) {
        const output = this.paneConsole(pane);
        if (!output) return false;

        pane.dataset.consoleOpen = open ? '1' : '0';
        output.classList.toggle('open', !!open);

        const button = pane.querySelector('.bmux-pane-console-btn');
        if (button) {
            button.textContent = open ? '\u25BE' : '\u25B8';
            button.title = open
                ? "Hide this pane's console (log toggle)"
                : "Show this pane's console (log toggle)";
        }

        output.style.height = `${this.getPaneConsoleHeight(pane)}px`;

        if (open) {
            const log = output.querySelector('.bmux-pane-output-log');
            if (log) log.scrollTop = log.scrollHeight;
        }

        this.scheduleSave();
        return !!open;
    }

    togglePaneConsole(pane) {
        return this.setPaneConsoleOpen(pane, !this.isPaneConsoleOpen(pane));
    }

    getPaneConsoleHeight(pane) {
        const stored = pane && pane.dataset ? parseInt(pane.dataset.consoleHeight, 10) : NaN;
        return isFinite(stored) && stored > 0 ? stored : BMUX_CONSOLE_HEIGHT;
    }

    /** Set the console height in px, clamped to the pane. Returns the applied px. */
    setPaneConsoleHeight(pane, px) {
        const output = this.paneConsole(pane);
        if (!output) return 0;

        // While detached the window owns the size, not the panel.
        if (this.isPaneConsoleFloating(pane) && pane._bmuxFloat) {
            const applied = Math.round(bmuxClamp(Number(px) || BMUX_CONSOLE_HEIGHT, 80, window.innerHeight - 80));
            pane._bmuxFloat.style.height = `${applied}px`;
            return applied;
        }

        const paneHeight = pane.getBoundingClientRect ? (pane.getBoundingClientRect().height || 0) : 0;
        const max = paneHeight ? Math.max(BMUX_CONSOLE_MIN_HEIGHT, paneHeight * BMUX_CONSOLE_MAX_SHARE) : 600;
        const applied = Math.round(bmuxClamp(Number(px) || BMUX_CONSOLE_HEIGHT, BMUX_CONSOLE_MIN_HEIGHT, max));

        pane.dataset.consoleHeight = String(applied);
        output.style.height = `${applied}px`;
        this.scheduleSave();
        return applied;
    }

    /** Append one block to a pane's scrollback, keeping the newest in view. */
    appendPaneOutput(pane, text, kind) {
        const output = this.paneConsole(pane);
        const log = output ? output.querySelector('.bmux-pane-output-log') : null;
        if (!log) return false;

        const block = document.createElement('div');
        block.className = `bmux-pane-output-block bmux-pane-output-${kind || 'result'}`;
        block.textContent = text == null ? '' : String(text);

        const nearBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
        log.appendChild(block);

        while (log.childElementCount > BMUX_CONSOLE_MAX_BLOCKS) {
            log.removeChild(log.firstChild);
        }

        if (nearBottom) log.scrollTop = log.scrollHeight;
        return true;
    }

    clearPaneConsole(pane) {
        const output = this.paneConsole(pane);
        const log = output ? output.querySelector('.bmux-pane-output-log') : null;
        if (!log) return false;
        log.textContent = '';
        return true;
    }

    /** Drag the top edge of a pane's console to resize it. */
    startConsoleResize(event, pane) {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const output = pane.querySelector('.bmux-pane-output');
        if (!output) return;

        const startY = event.clientY;
        const startHeight = this.getPaneConsoleHeight(pane);
        const previousCursor = document.body.style.cursor;
        document.body.style.cursor = 'row-resize';

        const shield = this.ui ? this.ui.dragShield : null;
        if (shield) shield.className = 'active row';

        const move = (moveEvent) => {
            this.setPaneConsoleHeight(pane, startHeight + (startY - moveEvent.clientY));
        };

        const up = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', up, true);
            document.body.style.cursor = previousCursor;
            if (shield) shield.className = '';
            this.log(`Console height: ${this.getPaneConsoleHeight(pane)}px`);
        };

        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
    }

}

window.bmux = new BMUXClient();
