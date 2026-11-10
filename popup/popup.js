/**
 * The extension-icon menu.
 *
 * Two actions and nothing else: **Toggle** shows or hides the overlay in the
 * tab you are looking at, **Settings** opens the page where the overlay's toolbar
 * is edited. With a popup declared, `chrome.action.onClicked` never fires — the
 * hotkey `Alt+Shift+B` remains the keyboard path straight into the overlay.
 */

(function () {
    'use strict';

    const tabLabel = document.getElementById('tab-label');
    const statusLine = document.getElementById('status');
    const toggleButton = document.getElementById('toggle');
    const settingsButton = document.getElementById('settings');
    const toggleHint = document.getElementById('toggle-hint');

    function say(text, kind) {
        statusLine.textContent = text;
        statusLine.className = kind || '';
    }

    /** The tab the user is looking at, or null when that is not available. */
    function activeTab() {
        return new Promise((resolve) => {
            try {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    resolve((tabs && tabs[0]) || null);
                });
            } catch (error) {
                resolve(null);
            }
        });
    }

    async function describeTab() {
        const tab = await targetTab();
        if (!tab) {
            tabLabel.textContent = 'this tab';
            return;
        }

        let host = '';
        try {
            host = new URL(tab.url || '').host;
        } catch (error) {
            host = '';
        }

        tabLabel.textContent = host || 'this tab';
        tabLabel.title = tab.url || '';
    }

    /**
     * The tab Toggle should act on. In a real popup the active tab is the page you
     * were looking at. When the menu page is opened as a tab instead (the options
     * page's sibling, or a test harness), that tab is the extension's own and has no
     * overlay, so fall back to the most recently active normal tab in this window.
     */
    async function targetTab() {
        const active = await activeTab();
        if (active && !/^chrome-extension:/i.test(active.url || '')) return active;

        return new Promise((resolve) => {
            try {
                chrome.tabs.query({ currentWindow: true }, (tabs) => {
                    const normal = (tabs || []).filter((tab) =>
                        tab.id !== undefined && !/^chrome-extension:/i.test(tab.url || ''));
                    resolve(normal.length ? normal[normal.length - 1] : null);
                });
            } catch (error) {
                resolve(null);
            }
        });
    }

    async function toggle() {
        const tab = await targetTab();
        if (!tab || tab.id === undefined) {
            say('No active tab to toggle', 'error');
            return;
        }

        chrome.tabs.sendMessage(tab.id, { command: 'toggle-bmux' }, (reply) => {
            const failed = chrome.runtime.lastError;
            if (failed) {
                say('This tab cannot host BMUX (reload the page once)', 'error');
                return;
            }
            say(reply && reply.status === 'ok' ? 'Toggled' : 'Toggled (no answer)', 'ok');
            // The popup closes itself so the overlay is what you see next.
            window.close();
        });
    }

    function openSettings() {
        try {
            chrome.runtime.openOptionsPage(() => window.close());
        } catch (error) {
            say('Could not open settings: ' + (error && error.message), 'error');
        }
    }

    if (toggleButton) toggleButton.addEventListener('click', toggle);
    if (settingsButton) settingsButton.addEventListener('click', openSettings);

    /** The extension version, from the manifest — the same number the overlay shows. */
    function describeVersion() {
        const slot = document.getElementById('version');
        if (!slot) return;

        try {
            const manifest = chrome.runtime.getManifest();
            if (manifest && manifest.version) {
                slot.textContent = `v${manifest.version}`;
                slot.title = `BMUX ${manifest.version}`;
            }
        } catch (error) {
            // No manifest access: leave the slot empty rather than guess.
        }
    }

    describeVersion();
    describeTab();

    // Hint at what Toggle will do, based on the shortcut documentation rather than
    // guessing the overlay's state (a popup cannot see another tab's DOM).
    if (toggleHint) toggleHint.textContent = 'show or hide the overlay (Alt+Shift+B)';
})();
