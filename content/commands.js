/**
 * BMUX Pane Command System
 * 
 * This file defines the command registry for pane-level commands.
 * Each pane has a command input at the bottom that can execute these commands.
 * 
 * To add a new command:
 * 1. Add an entry to the COMMANDS object below
 * 2. Implement the execute function
 * 3. The command will automatically be available and listed via 'help'
 */

// Helper function to safely access iframe content
function safeGetIframeDocument(iframe) {
    if (!iframe) return null;
    try {
        return iframe.contentDocument || iframe.contentWindow.document;
    } catch (e) {
        return null; // Cross-origin restriction
    }
}

// Helper function to check if iframe is accessible
function isIframeAccessible(iframe) {
    return safeGetIframeDocument(iframe) !== null;
}

// Helper function to get iframe URL safely
function safeGetIframeUrl(iframe) {
    if (!iframe) return null;
    try {
        return iframe.contentWindow.location.href;
    } catch (e) {
        // Cross-origin - fall back to src attribute
        return iframe.src || iframe.getAttribute('src');
    }
}

const BMUX_COMMANDS = {
    'help': {
        description: 'List all available commands',
        usage: 'help',
        execute: function (pane, args) {
            let output = '=== BMUX Pane Commands ===\n\n';
            for (const [cmd, info] of Object.entries(BMUX_COMMANDS)) {
                output += `${cmd}\n  ${info.description}\n  Usage: ${info.usage}\n\n`;
            }
            return output;
        }
    },

    'source': {
        description: 'Transform pane to console view showing HTML source',
        usage: 'source',
        execute: async function (pane, args) {
            const iframe = pane.querySelector('iframe');
            if (!iframe) {
                return 'Error: No iframe found in pane';
            }

            const doc = safeGetIframeDocument(iframe);
            if (!doc) {
                const url = safeGetIframeUrl(iframe);
                return `Error: Cross-origin content\nURL: ${url}`;
            }

            const source = doc.documentElement.outerHTML;

            // Hide iframe
            iframe.style.display = 'none';

            // Create console view
            let consoleView = pane.querySelector('.bmux-console-view');
            if (!consoleView) {
                consoleView = document.createElement('div');
                consoleView.className = 'bmux-console-view';
                consoleView.style.cssText = `
                    flex: 1;
                    background: #1a1a1a;
                    color: #0f0;
                    font-family: 'Consolas', monospace;
                    font-size: 11px;
                    padding: 10px;
                    overflow: auto;
                    white-space: pre-wrap;
                    word-break: break-all;
                `;
                pane.insertBefore(consoleView, pane.querySelector('.bmux-pane-footer'));
            }

            const formatted = source.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            consoleView.innerHTML = `<div style="color:#00aaff;margin-bottom:10px;">HTML SOURCE (${source.length} chars)</div>${formatted}`;

            return `Console view active. Use 'restore' to return.`;
        }
    },

    'restore': {
        description: 'Restore pane from console to browser view',
        usage: 'restore',
        execute: function (pane, args) {
            const iframe = pane.querySelector('iframe');
            const consoleView = pane.querySelector('.bmux-console-view');

            if (!consoleView) {
                return 'Already in browser view';
            }

            if (iframe) iframe.style.display = '';
            consoleView.remove();

            return 'Browser view restored';
        }
    },

    'filter': {
        description: 'Filter and display specific HTML elements from the page',
        usage: 'filter <selector>  (e.g., filter div, filter .className, filter #id)',
        execute: async function (pane, args) {
            if (args.length === 0) {
                return 'Error: Specify a CSS selector (e.g., filter div)';
            }

            const selector = args.join(' ');
            const iframe = pane.querySelector('iframe');
            if (!iframe) {
                return 'Error: No iframe found in pane';
            }

            const doc = safeGetIframeDocument(iframe);
            if (!doc) {
                const url = safeGetIframeUrl(iframe);
                return `Error: Cross-origin content\nURL: ${url}\n\nTip: Use 'url' command to load a same-origin page.`;
            }

            const elements = doc.querySelectorAll(selector);
            if (elements.length === 0) {
                return `No elements found matching: ${selector}`;
            }

            let output = `=== Found ${elements.length} element(s): "${selector}" ===\n\n`;
            elements.forEach((el, i) => {
                output += `[${i}] ${el.tagName}`;
                if (el.id) output += `#${el.id}`;
                if (el.className) output += `.${el.className}`;
                output += '\n';
                console.log(`Element ${i}:`, el);
            });
            output += '\nFull elements logged to console.';
            return output;
        }
    },

    'url': {
        description: 'Show or change the current pane URL',
        usage: 'url [new-url]',
        execute: function (pane, args) {
            const iframe = pane.querySelector('iframe');
            if (!iframe) return 'Error: No iframe found';

            if (args.length === 0) {
                const url = safeGetIframeUrl(iframe);
                return `Current URL: ${url}`;
            } else {
                const newUrl = args[0];
                iframe.src = newUrl;
                return `Navigating to: ${newUrl}`;
            }
        }
    },

    'reload': {
        description: 'Reload the current pane',
        usage: 'reload',
        execute: function (pane, args) {
            const iframe = pane.querySelector('iframe');
            if (!iframe) return 'Error: No iframe found';

            try {
                iframe.contentWindow.location.reload();
                return 'Reloading...';
            } catch (e) {
                // Cross-origin - try alternative
                iframe.src = iframe.src;
                return 'Reloading (cross-origin compatible)...';
            }
        }
    },

    'clear': {
        description: 'Clear the command output',
        usage: 'clear',
        execute: function (pane, args) {
            const output = pane.querySelector('.bmux-pane-output');
            if (output) output.textContent = '';
            return '';
        }
    }
};

// Export for use in main.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BMUX_COMMANDS;
}
