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
 *     api.client  - the top-frame BMUXClient (layout, pane and overlay primitives)
 *     api.pane    - the pane the command was invoked for, or the active pane
 *     api.log(msg)- append a line to the debug console
 *
 * Overlay commands manage the whole overlay and must not assume a pane exists.
 * Pane commands act on one pane's iframe / DOM and check api.pane themselves.
 *
 * To add a command: add one entry to BMUX_COMMANDS. It is then available from
 * every entry point, listed by `help`, and testable on its own.
 */

// Directions accepted by focus-pane and resize-pane.
const BMUX_DIRECTIONS = ['up', 'down', 'left', 'right'];

// Layout presets accepted by select-layout.
const BMUX_LAYOUT_NAMES = ['even-horizontal', 'even-vertical', 'main-vertical', 'main-horizontal', 'tiled'];

// Default resize step, in percentage points of the overlay.
const BMUX_RESIZE_STEP = 2;

// Default number of lines returned by capture-pane.
const BMUX_CAPTURE_LINES = 40;

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

/** Parse a size argument: "30%", "30" or "0.3" all mean 30% of the overlay. */
function bmuxParseSize(raw) {
    if (raw == null) return null;

    const text = String(raw).trim();
    if (!text) return null;

    const number = parseFloat(text.replace('%', ''));
    if (!isFinite(number) || number <= 0) return null;

    if (text.indexOf('%') !== -1) return number / 100;
    if (number <= 1) return number;
    return number / 100;
}

/**
 * Key bindings, as command lines.
 *
 * `control` is used in Control Mode (Alt+Shift+B), where keys need no prefix.
 * `prefix` is used after the TMUX-style Ctrl+b prefix.
 *
 * Escape in Control Mode is a command like any other, so main.js needs no
 * special case for it. Alt combinations are written "Alt+ArrowLeft"; keys that
 * are not listed are swallowed by Control Mode.
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
        'Alt+ArrowUp': `resize-pane -U ${BMUX_RESIZE_STEP}`,
        'Alt+ArrowDown': `resize-pane -D ${BMUX_RESIZE_STEP}`,
        'Alt+ArrowLeft': `resize-pane -L ${BMUX_RESIZE_STEP}`,
        'Alt+ArrowRight': `resize-pane -R ${BMUX_RESIZE_STEP}`,
        'z': 'resize-pane -Z',
        'q': 'display-panes',
        'o': 'cycle-pane next',
        ';': 'last-pane',
        'Space': 'next-layout',
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
        'ArrowRight': 'focus-pane right',
        'Alt+ArrowUp': `resize-pane -U ${BMUX_RESIZE_STEP}`,
        'Alt+ArrowDown': `resize-pane -D ${BMUX_RESIZE_STEP}`,
        'Alt+ArrowLeft': `resize-pane -L ${BMUX_RESIZE_STEP}`,
        'Alt+ArrowRight': `resize-pane -R ${BMUX_RESIZE_STEP}`,
        'z': 'resize-pane -Z',
        'q': 'display-panes',
        'o': 'cycle-pane next',
        ';': 'last-pane',
        'Space': 'next-layout'
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

            const footer = 'Panes are numbered top-to-bottom, left-to-right. ' +
                'The active pane is the one with the blue border.\n';

            return render('Overlay commands', groups.overlay) +
                render('Pane commands (act on one pane)', groups.pane).trimEnd() +
                '\n\n' + footer;
        }
    },

    'list-panes': {
        scope: 'overlay',
        description: 'List every pane: number, id, size, active marker, title and URL',
        usage: 'list-panes [-j|--json]',
        execute: function (api, args) {
            const client = api.client;
            const panes = client.getPanes();

            if (!panes.length) return 'No panes.';

            const wantJson = args.some((arg) => arg === '-j' || arg === '--json');

            if (wantJson) {
                return JSON.stringify(panes.map((pane) => {
                    const rect = client.getPaneRect(pane);
                    return {
                        number: client.getPaneNumber(pane),
                        id: client.getPaneId(pane),
                        title: client.getPaneTitle(pane),
                        active: pane === client.getActivePane(),
                        zoomed: client.isZoomed(pane),
                        size: {
                            x: Number(rect.x.toFixed(4)),
                            y: Number(rect.y.toFixed(4)),
                            w: Number(rect.w.toFixed(4)),
                            h: Number(rect.h.toFixed(4))
                        },
                        url: client.getPaneUrl(pane)
                    };
                }), null, 2);
            }

            const active = client.getActivePane();
            const width = String(panes.length).length;

            const rows = panes.map((pane) => {
                const number = String(client.getPaneNumber(pane)).padStart(width, ' ');
                const id = client.getPaneId(pane).padEnd(4, ' ');
                const size = client.getPaneSizeLabel(pane).padEnd(10, ' ');
                let marker = pane === active ? '[ACTIVE]' : '        ';
                if (client.isZoomed(pane)) marker = '[ZOOM]  ';
                const title = client.getPaneTitle(pane);
                return `${number} ${id} ${size} ${marker} ${title} - ${client.getPaneUrl(pane)}`;
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

    'last-pane': {
        scope: 'overlay',
        description: 'Focus the pane that was active before this one',
        usage: 'last-pane',
        execute: function (api, args) {
            const client = api.client;
            const result = client.lastPane();
            if (!result.ok) return `Error: ${result.message}`;
            return `Focus: pane ${client.getPaneNumber(result.pane)} (${client.getPaneId(result.pane)})`;
        }
    },

    'cycle-pane': {
        scope: 'overlay',
        description: 'Focus the next (or previous) pane in layout order',
        usage: 'cycle-pane [next|prev]',
        execute: function (api, args) {
            const client = api.client;
            const step = (args[0] || 'next').toLowerCase() === 'prev' ? -1 : 1;

            const result = client.cyclePane(step);
            if (!result.ok) return `Error: ${result.message}`;

            return `Focus: pane ${client.getPaneNumber(result.pane)} (${client.getPaneId(result.pane)})`;
        }
    },

    'split-window': {
        scope: 'overlay',
        description: 'Split the active pane; -h beside it, -v below it, with an optional size',
        usage: 'split-window [-h|-v] [-l <size>] [-b] [-d]  (size like 30% or 0.3)',
        execute: function (api, args) {
            const client = api.client;
            const panes = client.getPanes();

            if (!panes.length) return 'Error: No pane to split';

            let direction = 'horizontal';
            let size = null;
            let before = false;
            let keepFocus = false;

            for (let i = 0; i < args.length; i++) {
                const flag = args[i].toLowerCase();

                if (flag === '-h' || flag === 'h' || flag === 'horizontal') {
                    direction = 'horizontal';
                } else if (flag === '-v' || flag === 'v' || flag === 'vertical') {
                    direction = 'vertical';
                } else if (flag === '-l' || flag === '-p' || flag === '--size') {
                    size = bmuxParseSize(args[i + 1]);
                    if (size == null) return 'Error: Usage: split-window -l <size>  (e.g. 30% or 0.3)';
                    i++;
                } else if (flag === '-b') {
                    before = true;
                } else if (flag === '-d') {
                    keepFocus = true;
                } else if (args[i] !== '') {
                    return 'Error: Usage: split-window [-h|-v] [-l <size>] [-b] [-d]';
                }
            }

            if (size != null && (size < 0.1 || size > 0.9)) {
                return 'Error: Size must be between 10% and 90%';
            }

            const result = client.splitWindow(direction, {
                size: size,
                before: before,
                keepFocus: keepFocus
            });

            if (!result.ok) return `Error: ${result.message}`;

            const share = size == null ? 0.5 : size;
            return `Split ${direction}: ${Math.round(share * 100)}/${Math.round((1 - share) * 100)}` +
                `${before ? ' (new pane first)' : ''}${keepFocus ? ' (focus unchanged)' : ''}`;
        }
    },

    'kill-pane': {
        scope: 'overlay',
        description: 'Close a pane and give its space to its neighbour; the last pane stays',
        usage: 'kill-pane [number|%id]',
        execute: function (api, args) {
            const client = api.client;

            let target = client.getActivePane();
            if (args.length) {
                target = client.findPaneByToken(args[0]);
                if (!target) return `Error: No pane "${args[0]}". Type "list-panes" to see the panes.`;
            }

            if (!target) return 'Error: No pane to kill';

            const number = client.getPaneNumber(target);
            const id = client.getPaneId(target);
            const result = client.killPane(target);

            if (!result.ok) return `Error: ${result.message}`;

            const focused = result.pane
                ? ` Focus is on pane ${client.getPaneNumber(result.pane)} (${client.getPaneId(result.pane)}).`
                : '';
            return `Killed pane ${number} (${id}).${focused}`;
        }
    },

    'resize-pane': {
        scope: 'overlay',
        description: 'Resize the active pane: -L/-R/-U/-D by percent, -x <size>, or -Z to zoom',
        usage: 'resize-pane [-L|-R|-U|-D <percent>] [-x <size>] [-Z]',
        execute: function (api, args) {
            const client = api.client;
            const pane = api.pane || client.getActivePane();

            if (!pane) return 'Error: No pane to resize';

            const flags = args.map((arg) => arg.toLowerCase());

            if (flags.indexOf('-z') !== -1) {
                const result = client.zoomPane(pane);
                if (!result.ok) return `Error: ${result.message}`;
                return result.zoomed
                    ? `Zoomed pane ${client.getPaneNumber(pane)} (${client.getPaneId(pane)})`
                    : `Unzoomed: pane ${client.getPaneNumber(pane)} (${client.getPaneId(pane)})`;
            }

            let sizeIndex = -1;
            for (let i = 0; i < flags.length; i++) {
                if (flags[i] === '-x' || flags[i] === '--size') sizeIndex = i;
            }
            if (sizeIndex !== -1) {
                const size = bmuxParseSize(args[sizeIndex + 1]);
                if (size == null) return 'Error: Usage: resize-pane -x <size>  (e.g. 30% or 0.3)';

                const result = client.setPaneSize(pane, size);
                if (!result.ok) return `Error: ${result.message}`;
                return `Pane ${client.getPaneNumber(pane)} is now ${client.getPaneSizeLabel(pane)}`;
            }

            const directions = {
                '-l': 'left', '-r': 'right', '-u': 'up', '-d': 'down',
                'left': 'left', 'right': 'right', 'up': 'up', 'down': 'down'
            };

            let directionIndex = -1;
            for (let i = 0; i < flags.length; i++) {
                if (Object.prototype.hasOwnProperty.call(directions, flags[i])) {
                    directionIndex = i;
                    break;
                }
            }

            if (directionIndex === -1) {
                return 'Error: Usage: resize-pane [-L|-R|-U|-D <percent>] [-x <size>] [-Z]';
            }

            const direction = directions[flags[directionIndex]];
            const raw = args[directionIndex + 1];
            const percent = raw == null ? BMUX_RESIZE_STEP : parseFloat(String(raw).replace('%', ''));

            if (!isFinite(percent) || percent <= 0) {
                return 'Error: Give a positive percent to resize by (e.g. resize-pane -R 5)';
            }

            const result = client.resizePane(pane, direction, percent);
            if (!result.ok) return `Error: ${result.message}`;

            return `Resized ${direction}: pane ${client.getPaneNumber(pane)} is now ${client.getPaneSizeLabel(pane)}`;
        }
    },

    'select-layout': {
        scope: 'overlay',
        description: 'Rebuild the layout: even-horizontal, even-vertical, main-vertical, main-horizontal, tiled',
        usage: `select-layout <${BMUX_LAYOUT_NAMES.join('|')}>`,
        execute: function (api, args) {
            const client = api.client;
            const name = (args[0] || '').toLowerCase();

            if (!name) {
                return `Error: Usage: select-layout <${BMUX_LAYOUT_NAMES.join('|')}>`;
            }

            const result = client.applyLayout(name);
            if (!result.ok) return `Error: ${result.message}`;

            return `Layout: ${result.layout}`;
        }
    },

    'next-layout': {
        scope: 'overlay',
        description: 'Cycle to the next layout preset',
        usage: 'next-layout',
        execute: function (api, args) {
            const result = api.client.nextLayout();
            if (!result.ok) return `Error: ${result.message}`;
            return `Layout: ${result.layout}`;
        }
    },

    'swap-pane': {
        scope: 'overlay',
        description: 'Swap two panes; both keep running, only their positions change',
        usage: 'swap-pane <number|%id> [number|%id]  (second defaults to the active pane)',
        execute: function (api, args) {
            const client = api.client;

            if (!args.length) {
                return 'Error: Usage: swap-pane <number|%id> [number|%id]';
            }

            const first = client.findPaneByToken(args[0]);
            if (!first) return `Error: No pane "${args[0]}".`;

            const second = args[1]
                ? client.findPaneByToken(args[1])
                : client.getActivePane();
            if (!second) {
                return args[1] ? `Error: No pane "${args[1]}".` : 'Error: No active pane';
            }

            const firstId = client.getPaneId(first);
            const secondId = client.getPaneId(second);

            const result = client.swapPanes(first, second);
            if (!result.ok) return `Error: ${result.message}`;

            return `Swapped panes ${firstId} and ${secondId}`;
        }
    },

    'rotate-window': {
        scope: 'overlay',
        description: 'Move every pane one position along the layout (all pages keep running)',
        usage: 'rotate-window [-r|--reverse]',
        execute: function (api, args) {
            const reverse = args.some((arg) => arg === '-r' || arg === '--reverse');
            const result = api.client.rotatePanes(reverse);
            if (!result.ok) return `Error: ${result.message}`;
            return `Rotated panes ${reverse ? 'backwards' : 'forwards'}`;
        }
    },

    'display-panes': {
        scope: 'overlay',
        description: 'Show each pane number for a moment; press a digit to focus that pane',
        usage: 'display-panes',
        execute: function (api, args) {
            const result = api.client.displayPanes();
            if (!result.ok) return `Error: ${result.message}`;
            return `Select a pane by number (1-${result.panes}) within 2s`;
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

            let elements;
            try {
                elements = doc.querySelectorAll(selector);
            } catch (e) {
                return `Error: Invalid selector "${selector}"`;
            }

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

    'capture-pane': {
        scope: 'pane',
        description: 'Print the visible text of the pane (same-origin only)',
        usage: `capture-pane [-n <lines>]  (default ${BMUX_CAPTURE_LINES})`,
        execute: function (api, args) {
            const client = api.client;
            const pane = api.pane;
            if (!pane) return 'Error: No pane to capture';

            let limit = BMUX_CAPTURE_LINES;
            let nIndex = -1;
            for (let i = 0; i < args.length; i++) {
                if (args[i] === '-n') nIndex = i;
            }
            if (nIndex !== -1) {
                const parsed = parseInt(args[nIndex + 1], 10);
                if (!isFinite(parsed) || parsed <= 0) {
                    return 'Error: Usage: capture-pane [-n <lines>]';
                }
                limit = parsed;
            }

            const doc = safeGetIframeDocument(pane.querySelector('iframe'));
            if (!doc) {
                return `Error: Cross-origin content\nURL: ${client.getPaneUrl(pane)}\n\n` +
                    'Text capture needs a same-origin pane.';
            }

            const body = doc.body;
            const raw = body ? (body.innerText || body.textContent || '') : '';
            const lines = raw.split('\n').map((line) => line.trim()).filter((line) => line.length);

            if (!lines.length) return '(pane is empty)';

            const shown = lines.slice(-limit);
            const header = `=== ${client.getPaneTitle(pane)} (${shown.length}/${lines.length} lines) ===`;

            return `${header}\n\n${shown.join('\n')}`;
        }
    },

    'rename-pane': {
        scope: 'pane',
        description: 'Give the pane a title, shown in its footer (use "-" to clear it)',
        usage: 'rename-pane <title|->',
        execute: function (api, args) {
            const client = api.client;
            const pane = api.pane;
            if (!pane) return 'Error: No pane to rename';

            const title = args.join(' ').trim();
            if (!title) return 'Error: Usage: rename-pane <title|->';

            client.renamePane(pane, title);

            const resolved = client.getPaneTitle(pane);
            return title === '-'
                ? `Title cleared: pane ${client.getPaneNumber(pane)} shows "${resolved}"`
                : `Pane ${client.getPaneNumber(pane)} is now "${resolved}"`;
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
        BMUX_DIRECTIONS: BMUX_DIRECTIONS,
        BMUX_LAYOUT_NAMES: BMUX_LAYOUT_NAMES
    };
}
