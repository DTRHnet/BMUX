/**
 * BMUX Content Script (Client)
 *
 * The client owns the overlay's DOM, the pane layout and focus. It holds no
 * command definitions, help text or key-to-action switch: every command lives
 * in `content/commands.js`, and every entry point (toolbar, debug console,
 * `:` line, pane inputs, keys, background relay) ends up in `runCommand`.
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

/**
 * Own-property lookup. Command names and key bindings are data, not
 * prototypes: "constructor" or "__proto__" must report "unknown", never resolve
 * to an inherited function.
 */
function bmuxHasOwn(object, key) {
    return object != null && Object.prototype.hasOwnProperty.call(object, key);
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

class BMUXClient {
    constructor() {
        this.isTop = window.self === window.top;
        this.isActive = false; // Visibility state (only relevant for Top)
        this.prefixPressed = false;
        this.prefixTimeout = null;

        this.isControlMode = false;
        this.commandLineOpen = false;
        this.nextPaneId = 1;
        this.ui = null;

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

        // Modern HTML Structure
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
             </div>
          </div>

          <div id="bmux-panes">
            <!-- Panes will be injected here -->
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
            statusBar: overlay.querySelector('#bmux-status-bar'),
            statusLeft: overlay.querySelector('#bmux-status-left'),
            statusRight: overlay.querySelector('#bmux-status-right'),
            commandLine: overlay.querySelector('#bmux-command-line'),
            commandInput: overlay.querySelector('#bmux-command-input'),

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
            btnFocusRight: overlay.querySelector('#btn-focus-right')
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
        this.renderWindow({ root: null });
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
            // Toggle Command (usually from Popup) - Only Top cares
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
        // We capture in capture-phase to intercept before page
        document.addEventListener('keydown', (e) => this.handleKey(e), true);

        // 3. Focus sync: a click into a pane's iframe focuses the iframe, and
        // for a cross-origin frame that is all we can observe. The main window
        // blurring with an iframe as activeElement means that iframe's pane was
        // clicked, so make it the active pane.
        window.addEventListener('blur', () => this.syncActivePaneFromFocus(), true);
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
            this.ui.commandInput.focus();
        } else {
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
        // (The open state is tracked explicitly: reading the inline style would
        // also catch the line before it was ever opened, since the CSS keeps it
        // hidden and the inline style is empty.)
        if (this.isTop && this.ui && this.commandLineOpen &&
            document.activeElement === this.ui.commandInput) {
            if (e.key === 'Enter') {
                this.submitCommandLine();
                e.preventDefault(); e.stopPropagation();
            } else if (e.key === 'Escape') {
                // Escape closes the : line and leaves Control Mode on, as before.
                this.hideCommandMode();
                e.preventDefault(); e.stopPropagation();
            }
            return;
        }

        // CONTROL MODE LOGIC
        if (this.isControlMode) {
            // Allow typing in debug console even in Control Mode
            if (this.ui && document.activeElement === this.ui.debugInput) {
                return; // Let debug console handle its own keys
            }

            // Also allow typing in pane command inputs
            if (document.activeElement && document.activeElement.classList &&
                document.activeElement.classList.contains('bmux-pane-cmd-input')) {
                return; // Let pane command input handle its own keys
            }

            e.preventDefault();
            e.stopPropagation();

            this.log(`Control Key: ${e.key}`);

            const line = bmuxKeyBinding('control', e.key);
            if (line) {
                this.dispatchLine(line);
            }
            return;
        }

        // LEGACY PREFIX LOGIC (Ctrl+b)
        // Kept for those who prefer it
        if (e.ctrlKey && e.key === 'b') {
            console.log("Prefix detected");
            this.prefixPressed = true;
            chrome.runtime.sendMessage({ command: 'prefix-detected' });
            e.preventDefault(); e.stopPropagation();
            clearTimeout(this.prefixTimeout);
            this.prefixTimeout = setTimeout(() => {
                this.prefixPressed = false;
                console.log("Prefix Timeout");
            }, BMUX_PREFIX_TIMEOUT);
            return;
        }

        if (this.prefixPressed) {
            e.preventDefault();
            e.stopPropagation();
            this.prefixPressed = false;

            console.log("Command key in frame:", e.key);

            const line = bmuxKeyBinding('prefix', e.key);
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

    getPanes() {
        if (!this.ui) return [];
        return Array.prototype.slice.call(this.ui.panes.querySelectorAll('.bmux-pane'));
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

    /** Reading-order position, 1-based. Changes after a split or new window. */
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

        this.getPanes().forEach((candidate) => candidate.classList.remove('active'));
        pane.classList.add('active');

        this.refreshPaneBadges();

        if (this.ui && this.ui.statusRight) {
            this.ui.statusRight.textContent = `pane ${this.getPaneNumber(pane)} ${this.getPaneId(pane)}`;
        }
    }

    /** Refresh every footer badge to "[number id]", e.g. "[2 %2]". */
    refreshPaneBadges() {
        this.getPanes().forEach((pane, index) => {
            const badge = pane.querySelector('.bmux-pane-badge');
            if (badge) {
                badge.textContent = `[${index + 1} ${this.getPaneId(pane)}]`;
            }
        });
    }

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
        const current = this.getActivePane();

        if (!panes.length || !current) {
            return { ok: false, message: 'No panes to focus' };
        }
        if (panes.length === 1) {
            return { ok: false, message: 'Only one pane: split first' };
        }

        const picked = pickPaneInDirection(panes, current, direction, (pane) => this.paneRect(pane));
        if (!picked) {
            return { ok: false, message: `Cannot move focus ${direction}` };
        }

        this.setActivePane(picked.pane);

        return { ok: true, pane: picked.pane, wrapped: picked.wrapped, direction: direction };
    }

    // --- Layout ---

    splitWindow(direction) {
        if (!this.ui) return;

        const activePane = this.getActivePane();
        if (!activePane) {
            this.renderWindow({ root: null });
            return;
        }

        // Clone the URL from the active pane (safely handle cross-origin)
        const activeIframe = activePane.querySelector('iframe');
        let cloneUrl = window.location.href;

        if (activeIframe) {
            try {
                // Try to get the actual src first
                cloneUrl = activeIframe.src || activeIframe.contentWindow.location.href;
            } catch (e) {
                // Cross-origin restriction - use iframe src attribute
                cloneUrl = activeIframe.getAttribute('src') || window.location.href;
                this.log(`Cross-origin: Using src attribute (${cloneUrl.substring(0, 50)}...)`);
            }
        }

        const parent = activePane.parentNode;
        const container = document.createElement('div');
        container.className = 'bmux-split-container';
        container.style.display = 'flex';
        container.style.flex = activePane.style.flex || '1';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.flexDirection = direction === 'horizontal' ? 'row' : 'column';

        // Create new pane with cloned URL and command input
        const newPane = this.createPaneElement(cloneUrl);

        activePane.style.flex = '1';
        activePane.classList.remove('active');

        parent.replaceChild(container, activePane);
        container.appendChild(activePane);
        container.appendChild(newPane);

        this.setActivePane(newPane);
        this.log(`Split ${direction}: Cloned ${cloneUrl.substring(0, 50)}...`);
    }

    newWindow() {
        this.log("New Window: layout reset to one pane");
        this.renderWindow({ root: null });
    }

    renderWindow(windowData) {
        this.ui.panes.innerHTML = '';
        const currentUrl = window.location.href;
        const pane = this.createPaneElement(currentUrl);
        this.ui.panes.appendChild(pane);
        this.setActivePane(pane);
    }

    createPaneElement(url) {
        const pane = document.createElement('div');
        pane.className = 'bmux-pane active';
        pane.style.flex = '1';

        // Ids are assigned once and never reused; numbers are recomputed from DOM order.
        pane.dataset.paneId = `%${this.nextPaneId++}`;

        // Clicking anywhere on the pane makes it the active pane. Clicks that land
        // inside the iframe itself are caught by the window blur sync instead.
        pane.addEventListener('mousedown', () => this.setActivePane(pane));

        // Iframe
        const iframe = document.createElement('iframe');
        iframe.src = url || window.location.href;
        pane.appendChild(iframe);

        // Footer with command input
        const footer = document.createElement('div');
        footer.className = 'bmux-pane-footer';

        // Command Input Container
        const cmdContainer = document.createElement('div');
        cmdContainer.className = 'bmux-pane-cmd-container';

        const prompt = document.createElement('span');
        prompt.className = 'bmux-pane-cmd-prompt';
        prompt.textContent = '>';

        const input = document.createElement('input');
        input.className = 'bmux-pane-cmd-input';
        input.type = 'text';
        input.placeholder = 'Type "help" for commands';

        const badge = document.createElement('span');
        badge.className = 'bmux-pane-badge';
        badge.title = 'Pane number and id (focus-pane <number|%id>)';

        cmdContainer.appendChild(prompt);
        cmdContainer.appendChild(input);
        cmdContainer.appendChild(badge);

        // Output Container
        const output = document.createElement('div');
        output.className = 'bmux-pane-output';

        footer.appendChild(cmdContainer);
        footer.appendChild(output);
        pane.appendChild(footer);

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

    buildNode(node) {
        if (node.type === 'pane') {
            return this.createPaneElement(node.url || window.location.href);
        } else if (node.type === 'container') {
            const el = document.createElement('div');
            el.className = 'bmux-split-container';
            el.style.display = 'flex';
            el.style.flex = node.flex || '1';
            el.style.flexDirection = node.direction === 'horizontal' ? 'row' : 'column';
            if (node.children) {
                node.children.forEach(child => el.appendChild(this.buildNode(child)));
            }
            return el;
        }
        return document.createElement('div');
    }

    updateUI(state) {
        if (!this.ui) return;
        if (state && state.activeSessionId) {
            // Sync UI
        }
    }
}

window.bmux = new BMUXClient();
