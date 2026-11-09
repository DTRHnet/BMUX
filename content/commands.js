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

// A filter that is a preset, or that matches more than this many elements, asks
// for a yes/no answer before drawing anything.
const BMUX_FILTER_CONFIRM_THRESHOLD = 25;

// --- filter presets -------------------------------------------------------
//
// A preset is a word that expands to a selector, optionally narrowed by a
// variant and by a predicate. `filter links internal` therefore means "every
// link whose resolved origin is this page's origin", which no CSS selector can
// express on its own.

function bmuxLinkTarget(element, doc, view) {
    const href = element && element.getAttribute ? element.getAttribute('href') : '';
    if (!href) return null;

    try {
        const base = doc.baseURI || (view.location && view.location.href) || undefined;
        const resolved = new URL(href, base);
        if (resolved.protocol === 'javascript:' || resolved.protocol === 'data:') return null;
        return resolved;
    } catch (e) {
        return null;
    }
}

/**
 * The origin a link's "internal" judgement is made against: the pane document's
 * own origin, or — for pages that have no origin of their own (about:blank,
 * srcdoc) — the origin of its base URI.
 */
function bmuxDocumentOrigin(doc, view) {
    const origin = view && view.location ? view.location.origin : null;
    if (origin && origin !== 'null') return origin;

    try {
        return new URL(doc.baseURI).origin;
    } catch (e) {
        return null;
    }
}

function bmuxLinkIsInternal(element, doc, view) {
    const resolved = bmuxLinkTarget(element, doc, view);
    if (!resolved) return false;
    const origin = bmuxDocumentOrigin(doc, view);
    return !!origin && resolved.origin === origin;
}

function bmuxLinkIsExternal(element, doc, view) {
    const resolved = bmuxLinkTarget(element, doc, view);
    if (!resolved) return false;
    const origin = bmuxDocumentOrigin(doc, view);
    return !!origin && resolved.origin !== origin;
}

function bmuxImageIsLarge(element) {
    return (element.naturalWidth || 0) > 200;
}

/** Rendered at all (not display:none / visibility:hidden / no boxes). */
function bmuxIsVisible(element, view) {
    if (!element || !element.getClientRects) return true;

    let rects;
    try {
        rects = element.getClientRects();
    } catch (e) {
        return true;
    }
    if (!rects || !rects.length) return false;

    try {
        const style = view && view.getComputedStyle ? view.getComputedStyle(element) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
            return false;
        }
    } catch (e) {
        // getComputedStyle can throw for detached or opaque documents
    }

    return true;
}

/** `a && b` for two (element, doc, view) predicates. */
function bmuxComposeTests(first, second) {
    if (!first) return second || null;
    if (!second) return first;
    return (element, doc, view) => {
        try {
            return !!first(element, doc, view) && !!second(element, doc, view);
        } catch (e) {
            return false;
        }
    };
}

function bmuxImageIsBroken(element) {
    return !!element.complete && (element.naturalWidth || 0) === 0;
}

const BMUX_FILTER_PRESETS = {
    'links': {
        selector: 'a[href]',
        description: 'every link',
        variants: {
            'internal': {
                description: 'links that stay on this site',
                selector: 'a[href]',
                test: bmuxLinkIsInternal
            },
            'external': {
                description: 'links that leave this site',
                selector: 'a[href]',
                test: bmuxLinkIsExternal
            },
            'empty': {
                description: 'links with no text',
                selector: 'a[href]:empty, a[href="#"], a[href=""]'
            }
        }
    },
    'images': {
        selector: 'img',
        description: 'every image',
        variants: {
            'large': { description: 'images wider than 200px', selector: 'img', test: bmuxImageIsLarge },
            'noalt': { description: 'images with no alt text', selector: 'img:not([alt])' },
            'broken': { description: 'images that failed to load', selector: 'img', test: bmuxImageIsBroken }
        }
    },
    'headings': {
        selector: 'h1, h2, h3, h4, h5, h6',
        description: 'every heading'
    },
    'text': {
        selector: 'p, li, td, th, dd, blockquote',
        description: 'readable text blocks',
        variants: {
            'main': {
                description: 'text inside the main content',
                selector: 'main p, article p, #content p, .post-content p, [role="main"] p'
            }
        }
    },
    'inputs': {
        selector: 'input, select, textarea',
        description: 'form fields'
    },
    'buttons': {
        selector: 'button, input[type="submit"], input[type="button"], [role="button"]',
        description: 'clickable buttons'
    },
    'tables': {
        selector: 'table',
        description: 'tables',
        variants: {
            'rows': { description: 'table rows', selector: 'table tr' },
            'cells': { description: 'table cells', selector: 'table td, table th' }
        }
    },
    'media': {
        selector: 'img, video, audio, iframe, canvas, picture',
        description: 'images, videos and embeds',
        variants: {
            'video': {
                description: 'videos and player embeds',
                selector: 'video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="player"]'
            }
        }
    },
    'prices': {
        selector: '[data-price], .price, .product-price, [itemprop="price"], .amount',
        description: 'prices'
    },
    'comments': {
        selector: '.comment, .comment-body, .reply, [data-comment], #comments li',
        description: 'comments and replies'
    },
    'authors': {
        selector: '.byline, [rel="author"], [itemprop="author"], .author',
        description: 'author names'
    },
    'dates': {
        selector: 'time, [datetime], .date, .published',
        description: 'dates and timestamps'
    },
    'articles': {
        selector: 'article',
        description: 'articles',
        variants: {
            'headlines': {
                description: 'article headlines',
                selector: 'article h1, article h2, .headline, h1.article-title'
            }
        }
    },
    'forms': { selector: 'form', description: 'forms' },
    'code': { selector: 'pre, code', description: 'code blocks' },
    'main': {
        selector: 'main, article, #content, .post-content, [role="main"]',
        description: 'main content containers'
    }
};

/** `filter --presets`: the preset vocabulary, with its variants. */
function bmuxPresetListing() {
    let text = 'Filter presets (filter <preset> [variant]):\n\n';

    Object.keys(BMUX_FILTER_PRESETS).forEach((name) => {
        const preset = BMUX_FILTER_PRESETS[name];
        text += `${name}\n  ${preset.description}\n  selector: ${preset.selector}\n`;

        const variants = preset.variants ? Object.keys(preset.variants) : [];
        variants.forEach((variant) => {
            const entry = preset.variants[variant];
            text += `  variant ${variant}: ${entry.description} (${entry.selector || preset.selector})\n`;
        });

        text += '\n';
    });

    return text.trimEnd();
}

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
        'Z': 'resize-pane -Z',
        'q': 'display-panes',
        'o': 'cycle-pane next',
        ';': 'last-pane',
        'l': 'log toggle',
        'Space': 'next-layout',
        'Escape': 'escape'
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
        'Z': 'resize-pane -Z',
        'q': 'display-panes',
        'o': 'cycle-pane next',
        ';': 'last-pane',
        'l': 'log toggle',
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
                if (definition.hidden) continue;
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

    'persist': {
        scope: 'overlay',
        description: 'Turn layout auto-restore on or off (off clears this tab snapshot)',
        usage: 'persist [on|off|status]',
        execute: async function (api, args) {
            const client = api.client;
            const action = (args[0] || 'status').toLowerCase();

            if (action === 'status') {
                return `Auto-restore: ${client.persistEnabled ? 'on' : 'off'} · ` +
                    `this layout came from ${client.restoredFrom || 'a fresh start'}`;
            }

            if (action !== 'on' && action !== 'off') {
                return 'Error: Usage: persist [on|off|status]';
            }

            const result = await client.setPersistEnabled(action === 'on');
            if (!result.ok) return 'Error: the background did not answer';

            return result.enabled
                ? 'Auto-restore on: this tab layout is saved as it changes'
                : 'Auto-restore off: the tab snapshot was cleared and nothing more is written';
        }
    },

    'save-layout': {
        scope: 'overlay',
        description: 'Save the current layout under a name; named layouts survive restarts',
        usage: 'save-layout [name]',
        execute: async function (api, args) {
            const name = args.join(' ').trim() || 'default';

            const result = await api.client.saveNamedLayout(name);
            if (!result.ok) return `Error: ${result.reason || 'could not save the layout'}`;

            return `Saved layout "${result.name}" (${result.panes} pane(s))` +
                `${result.origin ? ` for ${result.origin}` : ''}`;
        }
    },

    'restore-layout': {
        scope: 'overlay',
        description: 'Apply a saved layout by name',
        usage: 'restore-layout <name>',
        execute: async function (api, args) {
            const client = api.client;

            if (!args[0]) {
                const listed = await client.listNamedLayouts();
                const names = (listed.layouts || []).map((entry) => entry.name);
                return names.length
                    ? `Error: Usage: restore-layout <name>. Saved: ${names.join(', ')}`
                    : 'Error: Usage: restore-layout <name> (nothing saved for this site yet)';
            }

            const result = await client.restoreNamedLayout(args[0]);
            if (!result.ok) {
                const listed = await client.listNamedLayouts();
                const names = (listed.layouts || []).map((entry) => entry.name);
                return `Error: ${result.reason}${names.length ? `. Saved: ${names.join(', ')}` : ''}`;
            }

            return `Restored layout "${result.name}" (${result.panes} pane(s))`;
        }
    },

    'list-layouts': {
        scope: 'overlay',
        description: 'List the layouts saved for this site',
        usage: 'list-layouts',
        execute: async function (api, args) {
            const listed = await api.client.listNamedLayouts();
            if (!listed.ok) return `Error: ${listed.reason}`;

            if (!listed.layouts.length) {
                return `No saved layouts for ${listed.origin || 'this site'}`;
            }

            const rows = listed.layouts.map((entry, index) => {
                const when = entry.savedAt
                    ? new Date(entry.savedAt).toISOString().replace('T', ' ').slice(0, 16)
                    : 'unknown';
                return `${index + 1}. ${entry.name} - ${entry.panes} pane(s) - ${when}`;
            });

            return [`Saved layouts for ${listed.origin || 'this site'}:`, ...rows].join('\n');
        }
    },

    'delete-layout': {
        scope: 'overlay',
        description: 'Delete a saved layout, or all of them for this site',
        usage: 'delete-layout <name|--all>',
        execute: async function (api, args) {
            if (!args[0]) return 'Error: Usage: delete-layout <name|--all>';

            const result = await api.client.deleteNamedLayout(args[0]);
            if (!result.ok) return `Error: ${result.reason || 'could not delete'}`;

            return result.deleted
                ? `Deleted ${result.deleted} layout(s)`
                : 'Nothing to delete';
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

    'escape': {
        scope: 'overlay',
        description: 'What Esc does: clear filter highlights if any, otherwise leave Control Mode',
        usage: 'escape',
        execute: function (api, args) {
            const client = api.client;

            if (client.hasActiveFilters()) {
                const cleared = client.clearAllFilters();
                return `Cleared ${cleared} filter highlight(s)`;
            }

            client.setControlMode(false);
            return 'Control Mode: false';
        }
    },

    'yes': {
        scope: 'overlay',
        description: 'Answer the open prompt affirmatively (refine, discard, confirm)',
        usage: 'yes  (alias: y)',
        execute: function (api, args) {
            const result = api.client.answerOpenPrompt('yes', api.pane);
            if (!result.ok) return `Error: ${result.message}`;
            return result.choice === 'yes' ? 'Confirmed' : `Answered: ${result.choice}`;
        }
    },

    'no': {
        scope: 'overlay',
        description: 'Answer the open prompt negatively (keep, cancel)',
        usage: 'no  (alias: n)',
        execute: function (api, args) {
            const result = api.client.answerOpenPrompt('no', api.pane);
            if (!result.ok) return `Error: ${result.message}`;
            return result.choice === 'no' ? 'Declined' : `Answered: ${result.choice}`;
        }
    },

    'y': {
        scope: 'overlay',
        hidden: true,
        description: 'Alias of yes',
        usage: 'y',
        execute: function (api, args) {
            const result = api.client.answerOpenPrompt('yes', api.pane);
            if (!result.ok) return `Error: ${result.message}`;
            return result.choice === 'yes' ? 'Confirmed' : `Answered: ${result.choice}`;
        }
    },

    'n': {
        scope: 'overlay',
        hidden: true,
        description: 'Alias of no',
        usage: 'n',
        execute: function (api, args) {
            const result = api.client.answerOpenPrompt('no', api.pane);
            if (!result.ok) return `Error: ${result.message}`;
            return result.choice === 'no' ? 'Declined' : `Answered: ${result.choice}`;
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
        description: 'Box every match in the pane, name each on hover, then optionally narrow it down',
        usage: 'filter <selector|preset> [-n max] [-y] [--in s] [--not-in s] [--text w] [--visible] ' +
            '[--unique] [--replace] | filter -l <target> | filter -c | filter --presets',
        execute: async function (api, args) {
            const client = api.client;
            const pane = api.pane;
            if (!pane) return 'Error: No pane to filter';

            let clear = false;
            let listOnly = false;
            let autoConfirm = false;
            let replace = false;
            let showPresets = false;
            let max = null;
            let insideSelector = '';
            let outsideSelector = '';
            let textNeedle = '';
            let visibleOnly = false;
            let uniqueBy = null;
            const words = [];

            for (let i = 0; i < args.length; i++) {
                const arg = args[i];

                if (arg === '-c' || arg === '--clear') {
                    clear = true;
                } else if (arg === '-l' || arg === '--list') {
                    listOnly = true;
                } else if (arg === '-y' || arg === '--yes' || arg === '--no-ask') {
                    autoConfirm = true;
                } else if (arg === '--replace') {
                    replace = true;
                } else if (arg === '--presets' || arg === 'presets') {
                    showPresets = true;
                } else if (arg === '-n' || arg === '--max') {
                    const parsed = parseInt(args[i + 1], 10);
                    if (!isFinite(parsed) || parsed <= 0) {
                        return 'Error: Usage: filter <selector> [-n <max>]';
                    }
                    max = parsed;
                    i++;
                } else if (arg === '--in' || arg === '--not-in') {
                    const selector = args[i + 1];
                    if (!selector) return `Error: Usage: filter <target> ${arg} <selector>`;
                    if (arg === '--in') insideSelector = selector;
                    else outsideSelector = selector;
                    i++;
                } else if (arg === '--text') {
                    const needle = args[i + 1];
                    if (!needle) return 'Error: Usage: filter <target> --text <word>';
                    textNeedle = needle;
                    i++;
                } else if (arg === '--visible') {
                    visibleOnly = true;
                } else if (arg === '--unique') {
                    const next = args[i + 1];
                    uniqueBy = next && ['href', 'src', 'text'].indexOf(next.toLowerCase()) !== -1
                        ? next.toLowerCase()
                        : 'href';
                    if (next && uniqueBy === next.toLowerCase()) i++;
                } else if (arg !== '') {
                    words.push(arg);
                }
            }

            if (showPresets) return bmuxPresetListing();

            if (clear) {
                const cleared = client.clearFilters(pane);
                return cleared ? `Cleared ${cleared} filter highlight(s)` : 'No filter highlights to clear';
            }

            const target = words.join(' ').trim();
            if (!target) {
                return 'Error: Usage: filter <selector|preset> [-n <max>] [-y] [--in s] [--not-in s] ' +
                    '[--text w] [--visible] [--unique] [--replace] | filter -l <target> | filter -c | ' +
                    'filter --presets';
            }

            // Preset word (+ optional variant) -> selector + predicate.
            let preset = null;
            let selector = target;
            let test = null;
            let label = target;

            const first = words[0] ? words[0].toLowerCase() : '';
            if (Object.prototype.hasOwnProperty.call(BMUX_FILTER_PRESETS, first)) {
                preset = BMUX_FILTER_PRESETS[first];
                selector = preset.selector;

                const second = words[1] ? words[1].toLowerCase() : '';
                if (second) {
                    if (preset.variants && Object.prototype.hasOwnProperty.call(preset.variants, second)) {
                        const variant = preset.variants[second];
                        if (variant.selector) selector = variant.selector;
                        if (variant.test) test = variant.test;
                    } else {
                        const known = preset.variants ? Object.keys(preset.variants) : [];
                        return `Error: "${words[0]}" has no variant "${words[1]}".` +
                            (known.length ? ` Try: ${known.join(', ')}` : ' It takes no variant.');
                    }
                }

                label = `${first}${second ? ' ' + second : ''}`;
            }

            // Inline constraint flags compose with the preset predicate.
            if (insideSelector) {
                const scope = insideSelector;
                test = bmuxComposeTests(test, (element) => {
                    try {
                        return !!element.closest(scope);
                    } catch (e) {
                        return false;
                    }
                });
                label += ` --in ${scope}`;
            }

            if (outsideSelector) {
                const scope = outsideSelector;
                test = bmuxComposeTests(test, (element) => {
                    try {
                        return !element.closest(scope);
                    } catch (e) {
                        return false;
                    }
                });
                label += ` --not-in ${scope}`;
            }

            if (textNeedle) {
                const needle = textNeedle.toLowerCase();
                test = bmuxComposeTests(test, (element) => (element.textContent || '').toLowerCase().includes(needle));
                label += ` --text ${textNeedle}`;
            }

            if (visibleOnly) {
                test = bmuxComposeTests(test, (element, doc, view) => bmuxIsVisible(element, view));
                label += ' --visible';
            }

            if (uniqueBy) label += ` --unique ${uniqueBy}`;

            const collected = client.collectFilterMatches(pane, selector, test);
            if (!collected.ok) return `Error: ${collected.message}`;

            let current = client.uniqueElements(collected.elements, uniqueBy);

            if (!current.length) {
                client.clearFilter(pane);
                return `No elements match ${label} (${selector})`;
            }

            const renderList = (elements) => {
                const listed = elements.slice(0, 20).map((element, index) =>
                    `[${index + 1}] ${client.describeElement(element)}`);
                let text = `=== ${elements.length} match(es): ${label} (${selector}) ===\n\n${listed.join('\n')}`;
                if (elements.length > listed.length) {
                    text += `\n... ${elements.length - listed.length} more not listed`;
                }
                return text;
            };

            if (listOnly) {
                return `${renderList(current)}\n\nList only (-l): nothing drawn.`;
            }

            // Draw first, label everything, then offer to narrow it down.
            // `filter img; filter a` accumulates: the second call adds to the
            // first instead of replacing it (use --replace for a clean slate).
            let applied = client.filterPane(pane, selector, {
                max: max,
                test: test,
                uniqueBy: uniqueBy,
                label: label,
                add: !replace
            });
            if (!applied.ok) return `Error: ${applied.message}`;

            let rounds = 0;
            let lastStep = '';

            // Only offer refinement for a preset or a big result set; a small
            // explicit selector draws and stops.
            const offerRefine = !autoConfirm &&
                (preset != null || current.length > BMUX_FILTER_CONFIRM_THRESHOLD);

            while (offerRefine && rounds < 6) {
                const answer = await api.ask({
                    question: `${current.length} ${label} found and labelled. Specify harder constraints?`,
                    details: `${selector} · ${applied.shown} box(es) on screen` +
                        (rounds ? ` · ${rounds} refinement(s)` : ''),
                    choices: [
                        { id: 'yes', label: 'Yes, refine', primary: true },
                        { id: 'no', label: 'No, keep these' }
                    ]
                });

                if (answer.cancelled || answer.choice !== 'yes') break;

                const step = await api.ask({
                    question: 'Narrow them down how?',
                    details: `${current.length} match(es) now`,
                    choices: [
                        { id: 'in', label: 'Inside a container…' },
                        { id: 'not-in', label: 'Exclude a container…' },
                        { id: 'text', label: 'Text contains…' },
                        { id: 'visible', label: 'Visible only' },
                        { id: 'unique', label: 'Unique targets' },
                        { id: 'done', label: 'Keep these', primary: true },
                        { id: 'cancel', label: 'Cancel filter' }
                    ]
                });

                if (step.cancelled || step.choice === 'done') break;

                if (step.choice === 'cancel') {
                    client.clearFilter(pane);
                    return 'Filter cancelled: boxes cleared';
                }

                let nextTest = null;
                let next = current;
                let note = '';

                if (step.choice === 'in' || step.choice === 'not-in') {
                    const asked = await api.askText({
                        question: step.choice === 'in'
                            ? 'Keep only matches inside which selector?'
                            : 'Drop matches inside which selector?',
                        placeholder: 'main, .content, article'
                    });
                    if (asked.cancelled || !asked.text) continue;

                    const scope = asked.text;
                    let valid = true;
                    try {
                        collected.doc.querySelector(scope);
                    } catch (e) {
                        valid = false;
                    }
                    if (!valid) return `Error: Invalid selector "${scope}"`;

                    nextTest = (element) => {
                        let inside = false;
                        try {
                            inside = !!element.closest(scope);
                        } catch (e) {
                            inside = false;
                        }
                        return step.choice === 'in' ? inside : !inside;
                    };
                    note = `${step.choice} ${scope}`;
                } else if (step.choice === 'text') {
                    const asked = await api.askText({
                        question: 'Keep only matches whose text contains…',
                        placeholder: 'price'
                    });
                    if (asked.cancelled || !asked.text) continue;

                    const needle = asked.text.toLowerCase();
                    nextTest = (element) => (element.textContent || '').toLowerCase().includes(needle);
                    note = `text "${asked.text}"`;
                } else if (step.choice === 'visible') {
                    nextTest = (element, doc, view) => bmuxIsVisible(element, view);
                    note = 'visible only';
                } else if (step.choice === 'unique') {
                    uniqueBy = uniqueBy || 'href';
                    next = client.uniqueElements(current, uniqueBy);
                    note = `unique by ${uniqueBy}`;
                } else {
                    continue;
                }

                if (nextTest) next = client.filterElements(pane, current, nextTest);

                rounds++;
                lastStep = note;

                if (!next.length) {
                    client.clearFilter(pane);
                    return `No matches left after ${note}: boxes cleared`;
                }

                if (nextTest) test = bmuxComposeTests(test, nextTest);

                current = next;
                applied = client.filterPane(pane, selector, {
                    elements: current,
                    parts: client.filters.has(pane) ? client.filters.get(pane).parts : null,
                    max: max,
                    test: test,
                    uniqueBy: uniqueBy,
                    label: label,
                    add: false
                });
                if (!applied.ok) return `Error: ${applied.message}`;

                api.log(`Refine ${rounds} (${note}): ${current.length} match(es), ${applied.shown} boxed`);
            }

            const refined = rounds
                ? ` after ${rounds} refinement(s)${lastStep ? ` (last: ${lastStep})` : ''}`
                : '';
            const truncated = collected.truncated
                ? `\n(stopped scanning at ${current.length > 0 ? 'the scan limit' : '0'}; the page has more matches)`
                : '';

            return `${renderList(current)}\n\nBoxed ${applied.shown} of ${applied.matched} match(es)${refined}. ` +
                'Hover one to name it in the pane status line; Esc or "filter -c" clears.' + truncated;
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

    'log': {
        scope: 'pane',
        description: 'Open, close, resize or clear this pane console (the scrollback under its input)',
        usage: 'log [toggle|on|off|clear|size <px>]',
        execute: function (api, args) {
            const client = api.client;
            const pane = api.pane;
            if (!pane) return 'Error: No pane';

            const action = (args[0] || 'toggle').toLowerCase();

            if (action === 'toggle') {
                const open = client.togglePaneConsole(pane);
                return open ? 'Console open' : 'Console closed';
            }

            if (action === 'on' || action === 'open') {
                client.setPaneConsoleOpen(pane, true);
                return 'Console open';
            }

            if (action === 'off' || action === 'close') {
                client.setPaneConsoleOpen(pane, false);
                return 'Console closed';
            }

            if (action === 'clear') {
                client.clearPaneConsole(pane);
                return 'Console cleared';
            }

            if (action === 'size') {
                const px = parseInt(args[1], 10);
                if (!isFinite(px) || px <= 0) return 'Error: Usage: log size <px>';
                client.setPaneConsoleOpen(pane, true);
                const applied = client.setPaneConsoleHeight(pane, px);
                return `Console height ${applied}px`;
            }

            return 'Error: Usage: log [toggle|on|off|clear|size <px>]';
        }
    },

    'clear': {
        scope: 'pane',
        description: 'Clear this pane console scrollback',
        usage: 'clear',
        execute: function (api, args) {
            const pane = api.pane;
            if (!pane) return '';

            api.client.clearPaneConsole(pane);
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
        BMUX_LAYOUT_NAMES: BMUX_LAYOUT_NAMES,
        BMUX_FILTER_PRESETS: BMUX_FILTER_PRESETS,
        BMUX_FILTER_CONFIRM_THRESHOLD: BMUX_FILTER_CONFIRM_THRESHOLD
    };
}
