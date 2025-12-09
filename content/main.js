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
                // Optional: Exit control mode after one command? 
                // TMUX stays in mode? No, TMUX is prefix-based. 
                // Vim is modal. Let's stay in mode until Esc.
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
        // ... logic from previous step, ensuring we look at 'this.ui.panes' ...
        let activePane = this.ui.panes.querySelector('.bmux-pane.active');
        if (!activePane) activePane = this.ui.panes.querySelector('.bmux-pane');

        if (!activePane) {
            // Init First
            this.renderWindow({ root: null });
            return;
        }

        const parent = activePane.parentNode;
        const container = document.createElement('div');
        container.className = 'bmux-split-container';
        container.style.display = 'flex';
        container.style.flex = activePane.style.flex || '1';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.flexDirection = direction === 'horizontal' ? 'row' : 'column';

        const newPane = document.createElement('div');
        newPane.className = 'bmux-pane active';
        newPane.style.flex = '1';
        newPane.innerHTML = `<iframe src="https://example.com"></iframe>`;

        activePane.style.flex = '1';
        activePane.classList.remove('active');

        parent.replaceChild(container, activePane);
        container.appendChild(activePane);
        container.appendChild(newPane);

        this.updateSelection();
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
        const pane = document.createElement('div');
        pane.className = 'bmux-pane active';
        pane.style.flex = '1';
        pane.innerHTML = '<iframe src="about:blank"></iframe>';
        this.ui.panes.appendChild(pane);
    }

    buildNode(node) {
        if (node.type === 'pane') {
            const el = document.createElement('div');
            el.className = 'bmux-pane';
            // Note: active state handling might need to be passed down or set separate
            if (node.active) el.classList.add('active');
            el.style.flex = node.flex || '1';

            // Pane Content (Iframe)
            const iframe = document.createElement('iframe');
            iframe.src = node.url || 'about:blank';
            el.appendChild(iframe);

            // Pane Footer
            const footer = document.createElement('div');
            footer.className = 'bmux-pane-footer';
            footer.innerHTML = `
                <button class="bmux-console-toggle">Console</button>
                <span class="bmux-pane-info">Pane #${node.id.substring(0, 4)}</span>
            `;

            // Bind Toggle
            const btn = footer.querySelector('.bmux-console-toggle');
            btn.onclick = () => {
                this.log(`Toggling console for pane ${node.id}`);
                // In future, this would open a per-pane console overlay
                this.ui.debugContainer.style.display = 'flex'; // Show global debug for now
                this.ui.debugInput.focus();
            };

            el.appendChild(footer);
            return el;
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
