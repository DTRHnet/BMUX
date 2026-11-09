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

function bmuxClamp(value, low, high) {
    if (value < low) return low;
    if (value > high) return high;
    return value;
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
 * The key a binding table is looked up with. Alt combinations are written as
 * "Alt+ArrowLeft" so keyboard and mouse resizing can share one table.
 */
function bmuxBindingKey(event) {
    // The space bar reports " ", which is unreadable in a binding table.
    const key = event.key === ' ' ? 'Space' : event.key;
    if (event.altKey && !event.ctrlKey && !event.metaKey) return `Alt+${key}`;
    return key;
}

/**
 * Resolve a key to the command line it runs, or null.
 * `mode` is 'control' or 'prefix'; the tables live in commands.js.
 */
function bmuxKeyBinding(mode, key) {
    if (typeof BMUX_KEYBINDINGS === 'undefined') return null;
    const table = BMUX_KEYBINDINGS[mode];
    if (!table) return null;
    return bmuxHasOwn(table, key) ? table[key] : null;
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

        // If top, fetch initial state
        if (this.isTop) {
            this.fetchState();
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
    }

    isTypingTarget() {
        const element = document.activeElement;
        if (!element) return false;
        return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
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
            if (next) {
                this.ui.overlay.style.border = "5px solid #00aaff"; // Modern Blue
                this.ui.statusLeft.textContent = " [CONTROL MODE] ";
                this.ui.statusLeft.style.backgroundColor = "#00aaff";
                this.ui.statusLeft.style.color = "#000";
            } else {
                this.ui.overlay.style.border = "none";
                this.ui.statusLeft.textContent = " [NORMAL] ";
                this.ui.statusLeft.style.backgroundColor = "transparent";
                this.ui.statusLeft.style.color = "#fff";
            }
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
          <div id="bmux-toolbar">
             <div style="font-weight:bold; margin-right:15px; color:#fff;">BMUX</div>
             <button class="bmux-btn" id="btn-split-h">Split H</button>
             <button class="bmux-btn" id="btn-split-v">Split V</button>
             <button class="bmux-btn" id="btn-new-win">New Window</button>
             <button class="bmux-btn" id="btn-detach">Detach</button>
             <div class="bmux-nav-group">
                <button class="bmux-btn bmux-btn-nav" id="btn-focus-up" title="focus-pane up">Up</button>
                <button class="bmux-btn bmux-btn-nav" id="btn-focus-down" title="focus-pane down">Down</button>
                <button class="bmux-btn bmux-btn-nav" id="btn-focus-left" title="focus-pane left">Left</button>
                <button class="bmux-btn bmux-btn-nav" id="btn-focus-right" title="focus-pane right">Right</button>
                <button class="bmux-btn bmux-btn-nav" id="btn-zoom" title="resize-pane -Z">Zoom</button>
                <button class="bmux-btn bmux-btn-nav" id="btn-layout" title="next-layout">Layout</button>
             </div>
          </div>

          <div id="bmux-panes">
            <!-- Panes are absolutely positioned children; handles sit above them -->
            <div id="bmux-handles"></div>
          </div>

          <!-- Draggable Debug Console -->
          <div id="bmux-debug-overlay">
             <div id="bmux-debug-header">Debug Console</div>
             <div id="bmux-debug-content"></div>
             <div id="bmux-debug-input-container">
                <span style="color:#0f0; margin-right:5px;">$</span>
                <input id="bmux-debug-input" type="text" placeholder="Run a command (help lists them)" />
             </div>
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
            <span id="bmux-status-right">Ready</span>
          </div>
        `;

        document.body.appendChild(overlay);

        // Cache Elements
        this.ui = {
            overlay: overlay,
            panes: overlay.querySelector('#bmux-panes'),
            handles: overlay.querySelector('#bmux-handles'),
            statusBar: overlay.querySelector('#bmux-status-bar'),
            statusLeft: overlay.querySelector('#bmux-status-left'),
            statusRight: overlay.querySelector('#bmux-status-right'),
            commandLine: overlay.querySelector('#bmux-command-line'),
            commandInput: overlay.querySelector('#bmux-command-input'),

            dragShield: overlay.querySelector('#bmux-drag-shield'),

            debug: overlay.querySelector('#bmux-debug-content'),
            debugHeader: overlay.querySelector('#bmux-debug-header'),
            debugContainer: overlay.querySelector('#bmux-debug-overlay'),
            debugInput: overlay.querySelector('#bmux-debug-input'),

            btnSplitH: overlay.querySelector('#btn-split-h'),
            btnSplitV: overlay.querySelector('#btn-split-v'),
            btnNewWin: overlay.querySelector('#btn-new-win'),
            btnDetach: overlay.querySelector('#btn-detach'),

            btnFocusUp: overlay.querySelector('#btn-focus-up'),
            btnFocusDown: overlay.querySelector('#btn-focus-down'),
            btnFocusLeft: overlay.querySelector('#btn-focus-left'),
            btnFocusRight: overlay.querySelector('#btn-focus-right'),
            btnZoom: overlay.querySelector('#btn-zoom'),
            btnLayout: overlay.querySelector('#btn-layout')
        };

        // Bind Toolbar
        // Every button runs the command it is named after, through the same
        // dispatcher as the console, so the toolbar cannot drift from commands.js.
        this.ui.btnSplitH.onclick = () => this.runCommandAndLog('split-window -h');
        this.ui.btnSplitV.onclick = () => this.runCommandAndLog('split-window -v');
        this.ui.btnNewWin.onclick = () => this.runCommandAndLog('new-window');
        this.ui.btnDetach.onclick = () => this.runCommandAndLog('detach');
        this.ui.btnFocusUp.onclick = () => this.runCommandAndLog('focus-pane up');
        this.ui.btnFocusDown.onclick = () => this.runCommandAndLog('focus-pane down');
        this.ui.btnFocusLeft.onclick = () => this.runCommandAndLog('focus-pane left');
        this.ui.btnFocusRight.onclick = () => this.runCommandAndLog('focus-pane right');
        this.ui.btnZoom.onclick = () => this.runCommandAndLog('resize-pane -Z');
        this.ui.btnLayout.onclick = () => this.runCommandAndLog('next-layout');

        // Bind Debug Input
        this.ui.debugInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = this.ui.debugInput.value.trim();
                this.ui.debugInput.value = '';

                if (cmd) {
                    this.runCommandAndLog(cmd);
                }
                e.stopPropagation();
            }
        });

        // Make Debug Draggable
        this.makeDraggable(this.ui.debugContainer, this.ui.debugHeader);

        // Initial Render
        this.renderWindow();
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
        // 1. Message Listener (from Background or Popup)
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (this.isTop && request.command === 'toggle-bmux') {
                this.toggle();
                sendResponse({ status: 'ok' });
            }

            // Command line relayed from the Background (a key pressed in a pane's
            // iframe, or in this frame when it is not the top frame)
            if (this.isTop && request.command === 'execute-line') {
                this.runCommandAndLog(request.line);
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

        // 4. The overlay can be resized; pane rects are fractions, so one render
        // keeps every pane proportional to the new size.
        window.addEventListener('resize', () => {
            if (this.ui) this.renderLayout();
        });
    }

    fetchState() {
        chrome.runtime.sendMessage({ command: 'get-state' }, (state) => {
            this.log("State Fetched");
            if (this.isTop) this.updateUI(state);
        });
    }

    toggle() {
        if (!this.isTop) return;
        this.isActive = !this.isActive;
        this.log(`Toggle: ${this.isActive}`);
        if (this.isActive) {
            this.ui.overlay.classList.remove('hidden');
            // Do not steal focus: keys must reach Control Mode, not a text field.
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
            this.renderLayout();
        } else {
            this.clearPaneIndexes();
            this.ui.overlay.classList.add('hidden');
        }
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

        // display-panes picker: while the numbers are on screen, a digit selects
        // that pane and Escape cancels.
        if (this.paneIndexPrompt && !this.isTypingTarget()) {
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

        // CONTROL MODE LOGIC
        if (this.isControlMode) {
            // Typing in the console or a pane input keeps working in Control Mode
            if (this.isTypingTarget()) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            this.log(`Control Key: ${e.key}`);

            const line = bmuxKeyBinding('control', bmuxBindingKey(e));
            if (line) {
                this.dispatchLine(line);
            }
            return;
        }

        // LEGACY PREFIX LOGIC (Ctrl+b)
        if (e.ctrlKey && e.key === 'b') {
            this.prefixPressed = true;
            chrome.runtime.sendMessage({ command: 'prefix-detected' });
            e.preventDefault(); e.stopPropagation();
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

            const line = bmuxKeyBinding('prefix', bmuxBindingKey(e));
            if (line) {
                this.dispatchLine(line);
            }
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
            this.runCommandAndLog(line);
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
            this.runCommandAndLog(value);
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
            log: (message) => this.log(message)
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

    // --- Pane primitives (used by commands.js through api.client) ---

    /** Panes in layout order (reading order of the split tree). */
    getPanes() {
        if (!this.ui) return [];
        const panes = [];
        this.collectPaneRefs(this.layout, panes);

        if (!panes.length) {
            return Array.prototype.slice.call(this.ui.panes.querySelectorAll('.bmux-pane'));
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

    refreshPaneTitles() {
        this.getPanes().forEach((pane) => {
            const title = pane.querySelector('.bmux-pane-title');
            if (title) title.textContent = this.getPaneTitle(pane);
        });
    }

    refreshStatus() {
        if (!this.ui || !this.ui.statusRight) return;

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

    /** Recompute rectangles from the tree and apply them. */
    renderLayout() {
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
        this.refreshStatus();
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
            this.renderWindow();
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
        if (this.zoomedPane === target) this.zoomedPane = null;
        if (this.lastActivePane === target) this.lastActivePane = null;

        // Promote the sibling into the parent's place.
        this.replaceNode(parent.parent, sibling);
        target.remove();

        this.layoutName = null;

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

    newWindow() {
        this.clearPaneIndexes();
        this.log('New Window: layout reset to one pane');
        this.renderWindow();
    }

    /** Reset the overlay to a single pane showing the current page. */
    renderWindow() {
        this.clearPaneIndexes();
        this.zoomedPane = null;
        this.layoutName = null;
        this.lastActivePane = null;
        this.rects = new Map();

        Array.prototype.slice.call(this.ui.panes.querySelectorAll('.bmux-pane'))
            .forEach((pane) => pane.remove());

        const pane = this.createPaneElement(window.location.href);
        this.ui.panes.appendChild(pane);
        this.layout = bmuxLeaf(pane);

        this.setActivePane(pane);
        this.renderLayout();
    }

    createPaneElement(url) {
        const pane = document.createElement('div');
        pane.className = 'bmux-pane';

        // Ids are assigned once and never reused; numbers follow the layout.
        pane.dataset.paneId = `%${this.nextPaneId++}`;

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

        const badge = document.createElement('span');
        badge.className = 'bmux-pane-badge';
        badge.title = 'Pane number and id (focus-pane <number|%id>)';

        cmdContainer.appendChild(prompt);
        cmdContainer.appendChild(input);
        cmdContainer.appendChild(title);
        cmdContainer.appendChild(badge);

        const output = document.createElement('div');
        output.className = 'bmux-pane-output';

        footer.appendChild(cmdContainer);
        footer.appendChild(output);
        pane.appendChild(footer);

        // Page title can become known only after the iframe loads (same-origin).
        iframe.addEventListener('load', () => this.refreshPaneTitles());

        // Bind command input
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmdText = input.value.trim();
                input.value = '';
                e.stopPropagation();

                if (cmdText) {
                    this.runPaneCommand(pane, cmdText, output);
                }
            }
        });

        return pane;
    }

    /** Run a command typed into a pane's input, showing the result in that pane. */
    async runPaneCommand(pane, cmdText, output) {
        const result = await this.runCommand(cmdText, { pane: pane });
        const name = cmdText.split(/\s+/)[0];

        if (output) {
            output.textContent = result || '';
            if (result) {
                output.classList.add('visible');
            } else {
                output.classList.remove('visible');
            }

            if (result && name !== 'help' && !result.startsWith('Error')) {
                setTimeout(() => output.classList.remove('visible'), 5000);
            }
        }

        return result;
    }

    updateUI(state) {
        if (!this.ui) return;
        if (state && state.activeSessionId) {
            // Sync UI
        }
    }
}

window.bmux = new BMUXClient();
