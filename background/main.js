/**
 * BMUX Background Script (Server)
 * Manages global state: Sessions, Windows, Panes.
 */

const STATE = {
    sessions: [],
    activeSessionId: null
};

// Initialize State
chrome.runtime.onInstalled.addListener(() => {
    console.log("BMUX Installed");
    loadState();
});

function loadState() {
    chrome.storage.local.get(['bmuxState'], (result) => {
        if (result.bmuxState) {
            Object.assign(STATE, result.bmuxState);
        } else {
            // Create default session if none exists
            createSession('default');
        }
    });
}

function saveState() {
    chrome.storage.local.set({ bmuxState: STATE });
}

// Session Management
function createSession(name) {
    const session = {
        id: Date.now().toString(),
        name: name || `session-${STATE.sessions.length}`,
        windows: [],
        activeWindowIndex: 0
    };

    // Create initial window
    const win = createWindow('bash');
    session.windows.push(win);

    STATE.sessions.push(session);
    if (!STATE.activeSessionId) {
        STATE.activeSessionId = session.id;
    }
    saveState();
    return session;
}

function createWindow(name) {
    return {
        id: Date.now().toString() + Math.random(),
        name: name || 'window',
        panes: [createPane()],
        layout: 'tiled'
    };
}

function createPane(url = 'about:blank') {
    return {
        id: Date.now().toString() + Math.random(),
        url: url,
        width: 100,
        height: 100
    };
}

// Command Handling (Global Shortcuts)
chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-bmux-mode') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { command: 'toggle-control-mode' });
            }
        });
    }
});

// Message Handling (Server API)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Received command:", request);

    switch (request.command) {
        case 'get-state':
            sendResponse(STATE);
            break;

        case 'new-session':
            const newSession = createSession(request.name);
            sendResponse(newSession);
            break;

        case 'split-window':
            // The actual split is currently handled by the content script (Client)
            // modifying the DOM. In a full implementation, the client would ask
            // the server to update the STATE, and then re-render. 
            // For now, we just acknowledge.
            sendResponse({ status: 'ok', msg: 'Split handled by client' });
            break;

        case 'relay-to-top':
            // Relay message back to the same tab, but specifically to the logic handling top frame
            // The content script in the top frame listens for 'execute-key'.
            if (sender.tab && sender.tab.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    command: 'execute-key',
                    action: request.action,
                    params: request.params
                });
            }
            sendResponse({ status: 'relayed' });
            break;

        case 'prefix-detected':
            // Optional global state tracking
            sendResponse({ status: 'ack' });
            break;

        default:
            sendResponse({ status: 'error', msg: 'Unknown command' });
    }
    return true; // Keep channel open for async response
});
