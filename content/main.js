/**
 * BMUX Content Script (Client)
 */

console.log("BMUX Client Loading...");
console.log("BMUX Client Loading in", window.self === window.top ? "TOP" : "FRAME", window.location.href);

class BMUXClient {
    constructor() {
        this.isTop = window.self === window.top;
        this.isActive = false; // Visibility state (only relevant for Top)
        this.prefixPressed = false;
        this.prefixTimeout = null;

        this.isControlMode = false;
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

    toggleControlMode() {
        this.isControlMode = !this.isControlMode;
        this.log(`Control Mode: ${this.isControlMode}`);

        if (this.ui) {
            if (this.isControlMode) {
                this.ui.overlay.style.border = "5px solid #00aaff"; // Modern Blue
                this.ui.statusLeft.innerText = " [CONTROL MODE] ";
                this.ui.statusLeft.style.backgroundColor = "#00aaff";
                this.ui.statusLeft.style.color = "#000";
            } else {
                this.ui.overlay.style.border = "none";
                this.ui.statusLeft.innerText = " [NORMAL] ";
                this.ui.statusLeft.style.backgroundColor = "transparent";
                this.ui.statusLeft.style.color = "#fff";
            }
        }
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
                <input id="bmux-debug-input" type="text" placeholder="Send command to active pane..." />
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
            commandLine: overlay.querySelector('#bmux-command-line'),
            commandInput: overlay.querySelector('#bmux-command-input'),

            debug: overlay.querySelector('#bmux-debug-content'),
            debugHeader: overlay.querySelector('#bmux-debug-header'),
            debugContainer: overlay.querySelector('#bmux-debug-overlay'),
            debugInput: overlay.querySelector('#bmux-debug-input'),

            btnSplitH: overlay.querySelector('#btn-split-h'),
            btnSplitV: overlay.querySelector('#btn-split-v'),
            btnNewWin: overlay.querySelector('#btn-new-win'),
            btnDetach: overlay.querySelector('#btn-detach')
        };

        // Bind Toolbar
        this.ui.btnSplitH.onclick = () => { this.log("Action: Split Horizontal"); this.splitWindow('horizontal'); };
        this.ui.btnSplitV.onclick = () => { this.log("Action: Split Vertical"); this.splitWindow('vertical'); };
        this.ui.btnNewWin.onclick = () => { this.log("Action: New Window"); this.newWindow(); };
        this.ui.btnDetach.onclick = () => { this.log("Action: Detach"); this.toggle(); };

        // Bind Debug Input
        this.ui.debugInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const cmd = this.ui.debugInput.value.trim();
                this.ui.debugInput.value = '';

                if (cmd) {
                    // Check if it's a BMUX command
                    if (typeof BMUX_COMMANDS !== 'undefined') {
                        const [cmdName, ...args] = cmd.split(' ');
                        const commandDef = BMUX_COMMANDS[cmdName];

                        if (commandDef) {
                            // Execute command (use active pane or first pane as context)
                            const activePane = this.ui.panes.querySelector('.bmux-pane.active') ||
                                this.ui.panes.querySelector('.bmux-pane');

                            if (activePane) {
                                try {
                                    const result = await commandDef.execute(activePane, args);
                                    this.log(`$ ${cmd}`);
                                    this.log(result);
                                } catch (err) {
                                    this.log(`$ ${cmd}`);
                                    this.log(`Error: ${err.message}`);
                                }
                            } else {
                                this.log(`$ ${cmd}`);
                                this.log('Error: No active pane');
                            }
                        } else {
                            // Not a command, just log it
                            this.log(`$ ${cmd}`);
                        }
                    } else {
                        this.log(`$ ${cmd}`);
                    }
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

            // Key Command (Relayed from Background) - Only Top cares
            if (this.isTop && request.command === 'execute-key') {
                this.log(`Exec Key: ${request.action}`);
                this.handleAction(request.action, request.params);
            }

            if (this.isTop && request.command === 'toggle-control-mode') {
                this.toggleControlMode();
            }
        });

        // 2. Key Listener (Capture locally and send to background)
        // We capture in capture-phase to intercept before page
        document.addEventListener('keydown', (e) => this.handleKey(e), true);
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

    handleKey(e) {
        // If we are in the Top frame and the Command Line is focused, handle locally
        if (this.isTop && this.isActive && document.activeElement === this.ui.commandInput && this.ui.commandLine.style.display !== 'none') {
            if (e.key === 'Enter') {
                this.executeCommand(this.ui.commandInput.value);
                this.hideCommandMode();
                e.preventDefault(); e.stopPropagation();
            } else if (e.key === 'Escape') {
                this.hideCommandMode();
                e.preventDefault(); e.stopPropagation();
            }
            return;
        }

        // CONTROL MODE LOGIC
        if (this.isControlMode) {
            // Allow typing in debug console even in Control Mode
            if (document.activeElement === this.ui.debugInput) {
                return; // Let debug console handle its own keys
            }

            // Also allow typing in pane command inputs
            if (document.activeElement && document.activeElement.classList.contains('bmux-pane-cmd-input')) {
                return; // Let pane command input handle its own keys
            }

            e.preventDefault();
            e.stopPropagation();

            const key = e.key;
            this.log(`Control Key: ${key}`);

            let action = null;
            let params = {};

            // Direct mapping (no prefix needed)
            switch (key) {
                case '%': action = 'split-window'; params = { direction: 'horizontal' }; break;
                case '"': action = 'split-window'; params = { direction: 'vertical' }; break;
                case 'c': action = 'new-window'; break;
                case 'x': action = 'kill-pane'; break;
                case 'd': action = 'detach'; break;
                case ':': action = 'command-mode'; break;
                case 'Escape': this.toggleControlMode(); return; // Exit mode
            }

            if (action) {
                chrome.runtime.sendMessage({
                    command: 'relay-to-top',
                    action: action,
                    params: params
                });
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
            }, 3000);
            return;
        }

        if (this.prefixPressed) {
            e.preventDefault();
            e.stopPropagation();
            this.prefixPressed = false;

            const key = e.key;
            console.log("Command key in frame:", key);

            let action = null;
            let params = {};

            switch (key) {
                case '%': action = 'split-window'; params = { direction: 'horizontal' }; break;
                case '"': action = 'split-window'; params = { direction: 'vertical' }; break;
                case 'c': action = 'new-window'; break;
                case 'x': action = 'kill-pane'; break;
                case 'd': action = 'detach'; break;
                case ':': action = 'command-mode'; break;
            }

            if (action) {
                chrome.runtime.sendMessage({
                    command: 'relay-to-top',
                    action: action,
                    params: params
                });
            }
        }
    }

    // --- Actions (Only executed in Top Frame) ---

    handleAction(action, params) {
        if (!this.isTop) return;
        console.log("Executing Action:", action, params);

        if (!this.isActive && action !== 'detach') {
            // If hidden, only allow detach or maybe we should auto-show?
            // For now, let's assume valid actions imply we want to see it? 
            // Or maybe we perform actions in bg. User must attach first.
        }

        switch (action) {
            case 'split-window':
                this.splitWindow(params.direction);
                break;
            case 'new-window':
                this.newWindow();
                break;
            case 'detach':
                this.toggle();
                break;
            case 'command-mode':
                this.showCommandMode();
                break;
            case 'kill-pane':
                // Implement kill pane
                console.log("Kill pane not impl yet");
                break;
        }
    }

    showCommandMode() {
        if (!this.ui) return;
        this.ui.commandLine.style.display = 'flex';
        this.ui.commandInput.value = '';
        this.ui.commandInput.focus();
    }

    hideCommandMode() {
        if (!this.ui) return;
        this.ui.commandLine.style.display = 'none';
    }

    executeCommand(cmdStr) {
        if (!cmdStr) return;
        this.log(`Cmd: ${cmdStr}`);
        const parts = cmdStr.split(' ');
        const cmd = parts[0];

        if (cmd === 'new-window') {
            this.newWindow();
        } else if (cmd === 'split-window') {
            const flag = parts[1];
            if (flag === '-h') this.splitWindow('horizontal');
            else if (flag === '-v') this.splitWindow('vertical');
        }
    }

    // --- Layout Logic (Same as before, simplified for brevity) ---

    splitWindow(direction) {
        if (!this.ui) return;
        let activePane = this.ui.panes.querySelector('.bmux-pane.active');
        if (!activePane) activePane = this.ui.panes.querySelector('.bmux-pane');

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
        newPane.classList.add('active');

        activePane.style.flex = '1';
        activePane.classList.remove('active');

        parent.replaceChild(container, activePane);
        container.appendChild(activePane);
        container.appendChild(newPane);

        this.updateSelection();
        this.log(`Split ${direction}: Cloned ${cloneUrl.substring(0, 50)}...`);
    }

    updateSelection() {
        const actives = this.ui.panes.querySelectorAll('.bmux-pane.active');
        if (actives.length > 1) {
            actives.forEach(el => el.classList.remove('active'));
            actives[actives.length - 1].classList.add('active');
        }
    }

    newWindow() {
        this.log("New Window Loop");
        this.renderWindow({ root: null });
    }

    renderWindow(windowData) {
        this.ui.panes.innerHTML = '';
        const currentUrl = window.location.href;
        const pane = this.createPaneElement(currentUrl);
        this.ui.panes.appendChild(pane);
    }

    createPaneElement(url) {
        const pane = document.createElement('div');
        pane.className = 'bmux-pane active';
        pane.style.flex = '1';

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

        cmdContainer.appendChild(prompt);
        cmdContainer.appendChild(input);

        // Output Container
        const output = document.createElement('div');
        output.className = 'bmux-pane-output';

        footer.appendChild(cmdContainer);
        footer.appendChild(output);
        pane.appendChild(footer);

        // Bind command input
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const cmdText = input.value.trim();
                input.value = '';

                if (cmdText) {
                    await this.executePaneCommand(pane, cmdText, output);
                }
                e.stopPropagation();
            }
        });

        return pane;
    }

    async executePaneCommand(pane, cmdText, output) {
        const [cmd, ...args] = cmdText.split(' ');

        this.log(`Pane Cmd: ${cmdText}`);

        if (typeof BMUX_COMMANDS === 'undefined') {
            output.textContent = 'Error: Command system not loaded';
            output.classList.add('visible');
            return;
        }

        const commandDef = BMUX_COMMANDS[cmd];
        if (!commandDef) {
            output.textContent = `Unknown: ${cmd}. Type "help" for commands.`;
            output.classList.add('visible');
            return;
        }

        try {
            const result = await commandDef.execute(pane, args);
            output.textContent = result;
            output.classList.add('visible');

            if (cmd !== 'help' && !result.startsWith('Error')) {
                setTimeout(() => output.classList.remove('visible'), 5000);
            }
        } catch (e) {
            output.textContent = `Error: ${e.message}`;
            output.classList.add('visible');
        }
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
