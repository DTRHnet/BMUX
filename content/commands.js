/**
 * BMUX Command Registry - the single source of truth for commands.
 *
 * Every way of running a command in BMUX resolves here:
 *   - toolbar buttons      -> the command line they are named after
 *   - debug console        -> whatever you type
 *   - `:` line (Control Mode) -> whatever you type
 *   - per-pane inputs      -> whatever you type, scoped to that pane
 *   - Control Mode / Ctrl+b keys -> BMUX_KEYBINDINGS[<mode>][<key>]
 *
 * `content/main.js` holds no command definitions, no help text and no
 * key-to-action switch. It only parses a line, looks the name up here and
 * calls `execute` with an `api` object.
 *
 * Command shape:
 *
 *     'name': {
 *         scope: 'overlay' | 'pane',
 *         description: 'One line, shown by help',
 *         usage: 'name <required> [optional]',
 *         execute: async function (api, args) { return 'text to display'; }
 *     }
 *
 * `api` is supplied by main.js:
 *     api.client  - the top-frame BMUXClient (pane and overlay primitives)
 *     api.pane    - the pane the command was invoked for, or the active pane
 *     api.log(msg)- append a line to the debug console
 *
 * Overlay commands manage the whole overlay and must not assume a pane exists.
 * Pane commands act on one pane's iframe / DOM and check api.pane themselves.
 *
 * To add a command: add one entry to BMUX_COMMANDS. It is then available from
 * every entry point, listed by `help`, and testable on its own.
 */

// Directions accepted by focus-pane.
const BMUX_DIRECTIONS = ['up', 'down', 'left', 'right'];

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

/**
 * Key bindings, as command lines.
 *
 * `control` is used in Control Mode (Alt+Shift+B), where keys need no prefix.
 * `prefix` is used after the TMUX-style Ctrl+b prefix.
 *
 * Escape in Control Mode is a command like any other, so main.js needs no
 * special case for it. Keys that are not listed are swallowed by Control Mode.
 */
const BMUX_KEYBINDINGS = {
    control: {
        '%': 'split-window -h',
        '"': 'split-window -v',
        'c': 'new-window',
        'x': 'kill-pane',
        'd': 'detach',
        ':': 'command-prompt',
        'ArrowUp': 'focus-pane up',
        'ArrowDown': 'focus-pane down',
        'ArrowLeft': 'focus-pane left',
        'ArrowRight': 'focus-pane right',
        'Escape': 'control-mode off'
    },
    prefix: {
        '%': 'split-window -h',
        '"': 'split-window -v',
        'c': 'new-window',
        'x': 'kill-pane',
        'd': 'detach',
        ':': 'command-prompt',
        'ArrowUp': 'focus-pane up',
        'ArrowDown': 'focus-pane down',
        'ArrowLeft': 'focus-pane left',
        'ArrowRight': 'focus-pane right'
    }
};

const BMUX_COMMANDS = {

    // --- Overlay commands (they manage the whole overlay) ---

    'help': {
        scope: 'overlay',
        description: 'List every command, grouped by scope',
        usage: 'help',
        execute: function (api, args) {
            const groups = { overlay: [], pane: [] };

            for (const [name, definition] of Object.entries(BMUX_COMMANDS)) {
                const group = definition.scope === 'pane' ? groups.pane : groups.overlay;
                group.push({ name: name, definition: definition });
            }

            const render = (title, entries) => {
                let text = `=== ${title} ===\n\n`;
                entries.forEach((entry) => {
                    text += `${entry.name}\n  ${entry.definition.description}\n  Usage: ${entry.definition.usage}\n\n`;
                });
                return text;
            };

            return render('Overlay commands', groups.overlay) +
                render('Pane commands (act on one pane)', groups.pane).trimEnd();
        }
    },

    'list-panes': {
        scope: 'overlay',
        description: 'List every pane: number, id, active marker and URL',
        usage: 'list-panes',
        execute: function (api, args) {
            const client = api.client;
            const panes = client.getPanes();

            if (!panes.length) {
                return 'No panes.';
            }

            const active = client.getActivePane();
            const width = String(panes.length).length;

            const rows = panes.map((pane) => {
                const number = String(client.getPaneNumber(pane)).padStart(width, ' ');
                const id = client.getPaneId(pane).padEnd(4, ' ');
                const marker = pane === active ? '[ACTIVE]' : '        ';
                return `${number} ${id} ${marker} ${client.getPaneUrl(pane)}`;
            });

            return ['Panes:', ...rows].join('\n');
        }
    },

    'focus-pane': {
        scope: 'overlay',
        description: 'Focus a pane by number, by id (%2), or in a direction (up|down|left|right, wraps)',
        usage: 'focus-pane <number|%id|up|down|left|right>',
        execute: function (api, args) {
            const client = api.client;
            const target = (args[0] || '').trim();

            if (!target) {
                return 'Error: Usage: focus-pane <number|%id|up|down|left|right>';
            }

            const direction = target.toLowerCase();
            if (BMUX_DIRECTIONS.indexOf(direction) !== -1) {
                const panes = client.getPanes();
                const result = client.focusDirection(direction);

                if (!result.ok) {
                    return `Error: ${result.message}`;
                }

                const where = `pane ${client.getPaneNumber(result.pane)}/${panes.length}`;
                return `Focus ${direction}: ${where}${result.wrapped ? ' (wrapped)' : ''}`;
            }

            const pane = client.findPaneByToken(target);
            if (!pane) {
                const hint = client.getPanes().length
                    ? ' Type "list-panes" to see the panes.'
                    : ' There are no panes.';
                return `Error: No pane "${target}".${hint}`;
            }

            client.setActivePane(pane);
            return `Focus: pane ${client.getPaneNumber(pane)} (${client.getPaneId(pane)})`;
        }
    },

    'split-window': {
        scope: 'overlay',
        description: 'Split the active pane; -h puts the new pane beside it, -v below it',
        usage: 'split-window [-h|-v]  (default -h)',
        execute: function (api, args) {
            const flag = (args[0] || '').toLowerCase();
            let direction;

            if (!flag || flag === '-h' || flag === 'h' || flag === 'horizontal') {
                direction = 'horizontal';
            } else if (flag === '-v' || flag === 'v' || flag === 'vertical') {
                direction = 'vertical';
            } else {
                return 'Error: Usage: split-window [-h|-v]';
            }

            api.client.splitWindow(direction);
            return `Split ${direction}`;
        }
    },

    'new-window': {
        scope: 'overlay',
        description: 'Reset the overlay to a single pane showing the current page',
        usage: 'new-window',
        execute: function (api, args) {
            api.client.newWindow();
            return 'New window: layout reset to one pane';
        }
    },

    'detach': {
        scope: 'overlay',
        description: 'Hide or show the overlay',
        usage: 'detach',
        execute: function (api, args) {
            api.client.toggle();
            return api.client.isActive ? 'Attached' : 'Detached';
        }
    },

    'kill-pane': {
        scope: 'overlay',
        description: 'Not implemented yet; reports that no pane was killed',
        usage: 'kill-pane',
        execute: function (api, args) {
            return 'kill-pane is not implemented yet: no pane was killed.';
        }
    },

    'control-mode': {
        scope: 'overlay',
        description: 'Turn Control Mode on, off, or toggle it',
        usage: 'control-mode [on|off|toggle]',
        execute: function (api, args) {
            const arg = (args[0] || 'toggle').toLowerCase();
            let next;

            if (arg === 'on') {
                next = true;
            } else if (arg === 'off') {
                next = false;
            } else if (arg === 'toggle') {
                next = !api.client.isControlMode;
            } else {
                return 'Error: Usage: control-mode [on|off|toggle]';
            }

            api.client.setControlMode(next);
            return `Control Mode: ${next}`;
        }
    },

    'command-prompt': {
        scope: 'overlay',
        description: 'Open the : command line (same commands, typed instead of clicked)',
        usage: 'command-prompt',
        execute: function (api, args) {
            api.client.showCommandMode();
            return '';
        }
    },

    // --- Pane commands (they act on one pane) ---

    'source': {
        scope: 'pane',
        description: 'Transform pane to console view showing HTML source',
        usage: 'source',
        execute: async function (api, args) {
            const pane = api.pane;
            if (!pane) return 'Error: No pane to show';

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
        scope: 'pane',
        description: 'Restore pane from console to browser view',
        usage: 'restore',
        execute: function (api, args) {
            const pane = api.pane;
            if (!pane) return 'Error: No pane to restore';

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
        scope: 'pane',
        description: 'Filter and display specific HTML elements from the page',
        usage: 'filter <selector>  (e.g., filter div, filter .className, filter #id)',
        execute: async function (api, args) {
            const pane = api.pane;
            if (!pane) return 'Error: No pane to filter';

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
        scope: 'pane',
        description: 'Show or change the current pane URL',
        usage: 'url [new-url]',
        execute: function (api, args) {
            const pane = api.pane;
            if (!pane) return 'Error: No pane';

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
        scope: 'pane',
        description: 'Reload the current pane',
        usage: 'reload',
        execute: function (api, args) {
            const pane = api.pane;
            if (!pane) return 'Error: No pane to reload';

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
        scope: 'pane',
        description: 'Clear the command output',
        usage: 'clear',
        execute: function (api, args) {
            const pane = api.pane;
            if (!pane) return '';

            const output = pane.querySelector('.bmux-pane-output');
            if (output) output.textContent = '';
            return '';
        }
    }
};

// Export for use in main.js (Chrome loads this file first, see manifest.json)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        BMUX_COMMANDS: BMUX_COMMANDS,
        BMUX_KEYBINDINGS: BMUX_KEYBINDINGS,
        BMUX_DIRECTIONS: BMUX_DIRECTIONS
    };
}
