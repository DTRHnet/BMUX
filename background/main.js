/**
 * BMUX Background Script (Server)
 *
 * Two jobs:
 *   1. relay a command line from a pane frame to the top frame (`relay-line` ->
 *      `execute-line`), and answer the browser-level hotkey command;
 *   2. own layout persistence: the content script asks, this script decides what
 *      is stored, where, and for how long.
 *
 * Persistence lives here rather than in the content script because
 * `chrome.storage.session` is not readable from content scripts without
 * `setAccessLevel`, and because only this script knows which tab is asking
 * (`sender.tab.id`) and when a tab goes away.
 *
 * Two layers, never `sync`:
 *   session : `layout:tab:<tabId>`          - survives reload/navigation, dies
 *                                             with the browser
 *   local   : `layout:named:<origin>:<name>` - explicit, named layouts that
 *                                             survive restarts
 *   local   : `persist:enabled`              - the auto-restore switch
 */

// Snapshot format. Version 2 holds a list of windows, each with its own split
// tree; version 1 had one tree at the top level and is upgraded on read, so a
// layout saved by 0.6.0 still restores.
const SNAPSHOT_VERSION = 2;
const LEGACY_SNAPSHOT_VERSION = 1;
const MAX_WINDOWS = 6;
const MAX_WINDOW_NAME = 32;
const MAX_TOTAL_PANES = 24;

const PERSIST_ENABLED_KEY = 'persist:enabled';
const PERSIST_INHERIT_KEY = 'persist:inherit';
const TAB_LAYOUT_PREFIX = 'layout:tab:';
const NAMED_PREFIX = 'layout:named:';

// Validation caps, applied on both write and read: a snapshot outside them is
// rejected whole rather than partially applied.
const MAX_PANES = 12;
const MAX_DEPTH = 32;
const MAX_NAMED_LAYOUTS = 30;
const MAX_SNAPSHOT_BYTES = 96 * 1024;

// Where `chrome.storage.session` is unavailable, the tab layer falls back to
// `local` with a short time-to-live so stale layouts do not pile up forever.
const SESSION_FALLBACK_TTL = 6 * 60 * 60 * 1000;

// --- storage helpers (promise shaped, tolerant of a missing area) ---

function sessionArea() {
    return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
}

function localArea() {
    return chrome.storage && chrome.storage.local ? chrome.storage.local : null;
}

function areaGet(area, keys) {
    return new Promise((resolve) => {
        if (!area) {
            resolve({});
            return;
        }
        try {
            area.get(keys, (result) => resolve(result || {}));
        } catch (e) {
            resolve({});
        }
    });
}

function areaSet(area, items) {
    return new Promise((resolve) => {
        if (!area) {
            resolve(false);
            return;
        }
        try {
            area.set(items, () => resolve(true));
        } catch (e) {
            resolve(false);
        }
    });
}

function areaRemove(area, keys) {
    return new Promise((resolve) => {
        if (!area) {
            resolve(false);
            return;
        }
        try {
            area.remove(keys, () => resolve(true));
        } catch (e) {
            resolve(false);
        }
    });
}

function tabLayoutKey(tabId) {
    return `${TAB_LAYOUT_PREFIX}${tabId}`;
}

function namedKey(origin, name) {
    return `${NAMED_PREFIX}${origin}:${name}`;
}

/** Stable origin (or the URL itself when the origin is opaque). */
function originOf(url) {
    const text = String(url || '');
    try {
        const parsed = new URL(text);
        if (parsed.origin && parsed.origin !== 'null') return parsed.origin;
        return text || 'unknown';
    } catch (e) {
        return text || 'unknown';
    }
}

// --- snapshot validation ---

function countPanes(node) {
    if (!node || typeof node !== 'object') return 0;
    if (node.kind === 'leaf') return 1;
    return countPanes(node.first) + countPanes(node.second);
}

function depthOf(node) {
    if (!node || typeof node !== 'object') return 0;
    if (node.kind === 'leaf') return 1;
    return 1 + Math.max(depthOf(node.first), depthOf(node.second));
}

/** Total panes across a version-1 or version-2 snapshot (used in listings). */
function snapshotPaneCount(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return 0;
    if (Array.isArray(snapshot.windows)) {
        return snapshot.windows.reduce((total, entry) => total + countPanes(entry && entry.layout), 0);
    }
    return countPanes(snapshot.layout);
}

/** A window name is short, printable and single-token ("select-window <name>"). */
function sanitizeWindowName(name) {
    const text = String(name == null ? '' : name).replace(/[\u0000-\u001f:]/g, '').trim();
    return text.slice(0, MAX_WINDOW_NAME);
}

/**
 * Accept a stored snapshot of either version and return a normalized version-2
 * one. This is the single migration point: the content script only ever sees v2,
 * so a layout saved before windows existed arrives as one window called "main".
 */
function normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return { ok: false, reason: 'not an object' };
    }

    const version = snapshot.version;
    if (version !== SNAPSHOT_VERSION && version !== LEGACY_SNAPSHOT_VERSION) {
        return { ok: false, reason: 'unknown version ' + version };
    }

    let windows;

    if (version === LEGACY_SNAPSHOT_VERSION) {
        if (!snapshot.layout || typeof snapshot.layout !== 'object') {
            return { ok: false, reason: 'no layout tree' };
        }
        windows = [{
            name: 'main',
            layout: snapshot.layout,
            activeId: snapshot.activeId || null,
            zoomedId: snapshot.zoomedId || null,
            rootPaneId: snapshot.rootPaneId || null,
            layoutName: snapshot.layoutName || null
        }];
    } else {
        if (!Array.isArray(snapshot.windows) || !snapshot.windows.length) {
            return { ok: false, reason: 'no windows' };
        }
        windows = snapshot.windows.map((entry) => {
            const window = entry && typeof entry === 'object' ? entry : {};
            return {
                name: sanitizeWindowName(window.name),
                layout: window.layout,
                activeId: window.activeId || null,
                zoomedId: window.zoomedId || null,
                rootPaneId: window.rootPaneId || null,
                layoutName: window.layoutName || null
            };
        });
    }

    if (windows.length > MAX_WINDOWS) {
        return { ok: false, reason: windows.length + ' windows is over the ' + MAX_WINDOWS + ' window cap' };
    }

    let total = 0;

    for (let i = 0; i < windows.length; i++) {
        const layout = windows[i].layout;

        if (!layout || typeof layout !== 'object') {
            return { ok: false, reason: 'window ' + (i + 1) + ' has no layout tree' };
        }

        const panes = countPanes(layout);
        if (panes < 1) return { ok: false, reason: 'window ' + (i + 1) + ' has no panes' };
        if (panes > MAX_PANES) {
            return { ok: false, reason: panes + ' panes in window ' + (i + 1) + ' is over the ' + MAX_PANES + ' pane cap' };
        }

        const depth = depthOf(layout);
        if (depth > MAX_DEPTH) {
            return { ok: false, reason: 'window ' + (i + 1) + ' depth ' + depth + ' is over the ' + MAX_DEPTH + ' cap' };
        }

        if (!isValidNode(layout)) {
            return { ok: false, reason: 'window ' + (i + 1) + ' has a malformed tree' };
        }

        total += panes;
    }

    if (total > MAX_TOTAL_PANES) {
        return { ok: false, reason: total + ' panes is over the ' + MAX_TOTAL_PANES + ' pane cap' };
    }

    const requested = Number(snapshot.activeWindow);
    const activeWindow = Number.isInteger(requested) && requested >= 0 && requested < windows.length
        ? requested
        : 0;

    const normalized = {
        version: SNAPSHOT_VERSION,
        savedAt: typeof snapshot.savedAt === 'number' && isFinite(snapshot.savedAt) ? snapshot.savedAt : 0,
        origin: typeof snapshot.origin === 'string' ? snapshot.origin : '',
        url: typeof snapshot.url === 'string' ? snapshot.url : '',
        nextPaneId: Number.isInteger(snapshot.nextPaneId) && snapshot.nextPaneId > 0 ? snapshot.nextPaneId : 1,
        prefs: snapshot.prefs && typeof snapshot.prefs === 'object' ? snapshot.prefs : {},
        consoles: snapshot.consoles && typeof snapshot.consoles === 'object' ? snapshot.consoles : {},
        activeWindow: activeWindow,
        windows: windows
    };

    let bytes = 0;
    try {
        bytes = JSON.stringify(normalized).length;
    } catch (e) {
        return { ok: false, reason: 'not serialisable' };
    }
    if (bytes > MAX_SNAPSHOT_BYTES) {
        return { ok: false, reason: bytes + ' bytes is over the ' + MAX_SNAPSHOT_BYTES + ' byte cap' };
    }

    return { ok: true, panes: total, windows: windows.length, snapshot: normalized };
}

/** Validate a snapshot and hand back the normalized (version 2) form to store. */
function validateSnapshot(snapshot) {
    return normalizeSnapshot(snapshot);
}

function isValidNode(node) {
    if (!node || typeof node !== 'object') return false;

    if (node.kind === 'leaf') {
        return !!node.pane && typeof node.pane === 'object' && typeof node.pane.url === 'string';
    }

    if (node.kind === 'split') {
        if (node.direction !== 'row' && node.direction !== 'column') return false;
        if (typeof node.ratio !== 'number' || !isFinite(node.ratio)) return false;
        if (node.ratio < 0.01 || node.ratio > 0.99) return false;
        return isValidNode(node.first) && isValidNode(node.second);
    }

    return false;
}

// --- persistence API ---

async function getEnabled() {
    const local = localArea();
    const stored = await areaGet(local, [PERSIST_ENABLED_KEY]);
    const value = stored[PERSIST_ENABLED_KEY];
    return value === undefined ? true : !!value;
}

async function setEnabled(enabled) {
    await areaSet(localArea(), { [PERSIST_ENABLED_KEY]: !!enabled });
    return !!enabled;
}

/**
 * A brand-new tab has no layout of its own. When inheritance is on it starts from
 * the newest layout any other tab has saved (session storage only, so it never
 * outlives the browser), with its own page substituted for that layout's root
 * pane. Off means every new tab starts with a single pane.
 */
async function getInherit() {
    const stored = await areaGet(localArea(), [PERSIST_INHERIT_KEY]);
    const value = stored[PERSIST_INHERIT_KEY];
    return value === undefined ? true : !!value;
}

async function setInherit(inherit) {
    await areaSet(localArea(), { [PERSIST_INHERIT_KEY]: !!inherit });
    return !!inherit;
}

/** The most recently saved layout belonging to a different tab, or null. */
async function newestOtherLayout(tabId) {
    const area = sessionArea() || localArea();
    const everything = await areaGet(area, null);
    const own = tabLayoutKey(tabId);

    let best = null;
    Object.keys(everything).forEach((key) => {
        if (key.indexOf(TAB_LAYOUT_PREFIX) !== 0 || key === own) return;

        const record = everything[key] || {};
        if (!record.savedAt || !record.snapshot) return;
        if (!best || record.savedAt > best.savedAt) {
            best = { savedAt: record.savedAt, snapshot: record.snapshot, tabId: key.slice(TAB_LAYOUT_PREFIX.length) };
        }
    });

    if (!best) return null;

    const check = validateSnapshot(best.snapshot);
    if (!check.ok) return null;
    return best;
}

/**
 * The tab layer: `storage.session` when available, otherwise `local` with a
 * time-to-live marker so stale layouts are dropped on read.
 */
async function tabArea() {
    return sessionArea() ? { area: sessionArea(), fallback: false } : { area: localArea(), fallback: true };
}

async function saveTabLayout(tabId, snapshot) {
    if (tabId === undefined || tabId === null) return { ok: false, reason: 'no tab id' };
    if (!(await getEnabled())) return { ok: false, reason: 'persistence is off' };

    const check = validateSnapshot(snapshot);
    if (!check.ok) return { ok: false, reason: check.reason };

    const { area, fallback } = await tabArea();
    const record = fallback
        ? { snapshot: check.snapshot, savedAt: Date.now(), fallback: true }
        : { snapshot: check.snapshot, savedAt: Date.now() };

    await areaSet(area, { [tabLayoutKey(tabId)]: record });
    return { ok: true, panes: check.panes, windows: check.windows, fallback: fallback };
}

async function loadTabLayout(tabId) {
    if (tabId === undefined || tabId === null) return { ok: false, reason: 'no tab id' };

    const { area } = await tabArea();
    const stored = await areaGet(area, [tabLayoutKey(tabId)]);
    const record = stored[tabLayoutKey(tabId)];

    if (!record) return { ok: true, snapshot: null };

    if (record.fallback && record.savedAt && Date.now() - record.savedAt > SESSION_FALLBACK_TTL) {
        await areaRemove(area, [tabLayoutKey(tabId)]);
        return { ok: true, snapshot: null, reason: 'expired' };
    }

    const check = validateSnapshot(record.snapshot);
    if (!check.ok) {
        await areaRemove(area, [tabLayoutKey(tabId)]);
        return { ok: true, snapshot: null, reason: check.reason };
    }

    return { ok: true, snapshot: check.snapshot };
}

async function clearTabLayout(tabId) {
    const { area } = await tabArea();
    await areaRemove(area, [tabLayoutKey(tabId)]);
    return { ok: true };
}

async function listNamedLayouts(origin) {
    const local = localArea();
    const everything = await areaGet(local, null);
    const prefix = `${NAMED_PREFIX}${origin}:`;

    return Object.keys(everything)
        .filter((key) => key.indexOf(prefix) === 0)
        .map((key) => {
            const record = everything[key] || {};
            return {
                name: key.slice(prefix.length),
                savedAt: record.savedAt || 0,
                panes: record.panes || snapshotPaneCount(record.snapshot)
            };
        })
        .sort((a, b) => b.savedAt - a.savedAt);
}

async function saveNamedLayout(origin, name, snapshot) {
    const clean = String(name || '').trim();
    if (!clean) return { ok: false, reason: 'no name' };
    if (/[:\s]/.test(clean)) return { ok: false, reason: 'a layout name cannot contain ":" or whitespace' };

    const check = validateSnapshot(snapshot);
    if (!check.ok) return { ok: false, reason: check.reason };

    const local = localArea();
    const record = { savedAt: Date.now(), panes: check.panes, snapshot: check.snapshot };
    await areaSet(local, { [namedKey(origin, clean)]: record });

    // Keep the newest MAX_NAMED_LAYOUTS for this origin.
    const all = await listNamedLayouts(origin);
    if (all.length > MAX_NAMED_LAYOUTS) {
        const stale = all.slice(MAX_NAMED_LAYOUTS).map((entry) => namedKey(origin, entry.name));
        await areaRemove(local, stale);
    }

    return { ok: true, name: clean, panes: check.panes, windows: check.windows };
}

async function loadNamedLayout(origin, name) {
    const clean = String(name || '').trim();
    if (!clean) return { ok: false, reason: 'no name' };

    const stored = await areaGet(localArea(), [namedKey(origin, clean)]);
    const record = stored[namedKey(origin, clean)];
    if (!record) return { ok: true, snapshot: null, reason: `no layout named "${clean}"` };

    const check = validateSnapshot(record.snapshot);
    if (!check.ok) return { ok: true, snapshot: null, reason: check.reason };

    return { ok: true, snapshot: check.snapshot, name: clean };
}

async function deleteNamedLayouts(origin, name) {
    const local = localArea();

    if (!name || name === '--all' || name === 'all') {
        const all = await listNamedLayouts(origin);
        if (!all.length) return { ok: true, deleted: 0 };
        await areaRemove(local, all.map((entry) => namedKey(origin, entry.name)));
        return { ok: true, deleted: all.length };
    }

    const clean = String(name).trim();
    await areaRemove(local, [namedKey(origin, clean)]);
    return { ok: true, deleted: 1, name: clean };
}

// --- running code in a pane's page world ---
//
// MV3 forbids `eval` inside a content script, so `eval` asks the background to run
// the expression in the frame's MAIN world through `chrome.scripting`. The pane's
// frame id comes from the frame itself (`frame-id`), never guessed.

async function execInFrame(tabId, frameId, code) {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
        return { ok: false, reason: 'the scripting permission is not available' };
    }
    if (tabId === undefined || tabId === null) return { ok: false, reason: 'no tab id' };

    const target = {
        tabId: tabId,
        frameIds: [frameId === undefined || frameId === null ? 0 : frameId]
    };

    try {
        const results = await chrome.scripting.executeScript({
            target: target,
            world: 'MAIN',
            args: [String(code)],
            func: function (source) {
                // Runs in the page's world: no closure, only `source`.
                function serialise(value, depth) {
                    const level = depth || 0;
                    if (value === null) return null;
                    if (value === undefined) return '[undefined]';

                    const type = typeof value;
                    if (type === 'string') {
                        const text = String(value);
                        return text.length > 300 ? text.slice(0, 300) + '…' : text;
                    }
                    if (type === 'number' || type === 'boolean') return value;
                    if (type === 'function') return '[function ' + (value.name || 'anonymous') + ']';
                    if (type === 'bigint') return String(value) + 'n';
                    if (type === 'symbol') return String(value);
                    if (value instanceof Error) return value.name + ': ' + value.message;

                    if (typeof Node !== 'undefined' && value instanceof Node) {
                        const tag = value.tagName ? value.tagName.toLowerCase() : 'node';
                        return '<' + tag + (value.id ? '#' + value.id : '') + '>';
                    }

                    if (level >= 3) return Array.isArray(value) ? '[array ×' + value.length + ']' : '[object]';

                    if (Array.isArray(value)) {
                        const items = value.slice(0, 50).map(function (item) { return serialise(item, level + 1); });
                        if (value.length > 50) items.push('…' + (value.length - 50) + ' more');
                        return items;
                    }

                    if (value instanceof Map) return '[Map ×' + value.size + ']';
                    if (value instanceof Set) return '[Set ×' + value.size + ']';

                    const out = {};
                    let keys = [];
                    try {
                        keys = Object.keys(value);
                    } catch (error) {
                        return '[object]';
                    }
                    keys.slice(0, 50).forEach(function (key) {
                        out[key] = serialise(value[key], level + 1);
                    });
                    return out;
                }

                try {
                    const value = (0, eval)(source);
                    return { ok: true, type: typeof value, value: serialise(value, 0) };
                } catch (error) {
                    return { ok: false, error: String(error && error.message ? error.message : error) };
                }
            }
        });

        const first = Array.isArray(results) ? results[0] : null;
        if (!first) return { ok: false, reason: 'the frame returned nothing (blocked or gone)' };

        const value = first.result;
        if (!value) return { ok: false, reason: 'the frame returned nothing (a CSP may have blocked it)' };

        return value.ok
            ? { ok: true, type: value.type, value: value.value }
            : { ok: false, reason: value.error };
    } catch (error) {
        return { ok: false, reason: error && error.message ? error.message : String(error) };
    }
}

// --- toolbar configuration ---
//
// The overlay's toolbar is a list of `{ label, command }` pairs the user can edit
// in the settings page (verified against the command registry there, and again by
// the content script that renders it). The background owns the storage, like every
// other persisted thing: the content script and the settings page only ask.

const TOOLBAR_KEY = 'toolbar:buttons';
const MAX_TOOLBAR_BUTTONS = 24;
const MAX_BUTTON_LABEL = 24;
const MAX_BUTTON_COMMAND = 120;

const DEFAULT_TOOLBAR = [
    { label: 'Split H', command: 'split-window -h' },
    { label: 'Split V', command: 'split-window -v' },
    { label: 'New Window', command: 'new-window' },
    { label: 'Panes', command: 'list-panes' },
    { label: 'Windows', command: 'list-windows' },
    { label: 'Cookies', command: 'list-cookies' },
    { label: 'Storage', command: 'list-storage' },
    { label: 'Forms', command: 'list-forms' },
    { label: 'Outline', command: 'outline' },
    { label: 'Up', command: 'focus-pane up' },
    { label: 'Down', command: 'focus-pane down' },
    { label: 'Left', command: 'focus-pane left' },
    { label: 'Right', command: 'focus-pane right' },
    { label: 'Zoom', command: 'resize-pane -Z' },
    { label: 'Layout', command: 'next-layout' },
    { label: 'Detach', command: 'detach' }
];

/** Structural validation; the command itself is verified against the registry. */
function cleanToolbarButton(entry) {
    if (!entry || typeof entry !== 'object') return null;

    const label = String(entry.label == null ? '' : entry.label)
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, MAX_BUTTON_LABEL);
    const command = String(entry.command == null ? '' : entry.command)
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, MAX_BUTTON_COMMAND);

    if (!label || !command) return null;
    return { label: label, command: command };
}

function cleanToolbar(buttons) {
    if (!Array.isArray(buttons)) return { ok: false, reason: 'the toolbar must be a list' };

    const cleaned = [];
    for (let i = 0; i < buttons.length && cleaned.length < MAX_TOOLBAR_BUTTONS; i++) {
        const button = cleanToolbarButton(buttons[i]);
        if (!button) continue;
        const duplicate = cleaned.some((existing) =>
            existing.label === button.label && existing.command === button.command);
        if (!duplicate) cleaned.push(button);
    }

    if (!cleaned.length) return { ok: false, reason: 'the toolbar needs at least one button' };
    return { ok: true, buttons: cleaned };
}

async function getToolbar() {
    const stored = await areaGet(localArea(), [TOOLBAR_KEY]);
    const record = stored[TOOLBAR_KEY];
    const custom = record && Array.isArray(record.buttons) ? cleanToolbar(record.buttons) : null;

    if (custom && custom.ok) {
        return { ok: true, buttons: custom.buttons, source: 'custom' };
    }

    return { ok: true, buttons: DEFAULT_TOOLBAR.slice(), source: 'default' };
}

async function setToolbar(buttons) {
    const cleaned = cleanToolbar(buttons);
    if (!cleaned.ok) return cleaned;

    await areaSet(localArea(), { [TOOLBAR_KEY]: { buttons: cleaned.buttons, savedAt: Date.now() } });
    return { ok: true, buttons: cleaned.buttons, source: 'custom' };
}

async function resetToolbar() {
    await areaRemove(localArea(), [TOOLBAR_KEY]);
    return { ok: true, buttons: DEFAULT_TOOLBAR.slice(), source: 'default' };
}

// --- cookies ---
//
// The content script cannot read `httpOnly` cookies (they are invisible to
// `document.cookie`), and cannot touch a cross-origin pane's cookies at all, so
// the background brokers them through the `cookies` permission.

function cookiesApi() {
    return chrome.cookies || null;
}

function cookieUrlFor(url) {
    try {
        return new URL(String(url)).href;
    } catch (error) {
        return '';
    }
}

/** A cookie as the console wants it: no secrets dropped, no undefined fields. */
function describeCookie(cookie) {
    const sameSite = String(cookie.sameSite || 'unspecified').toLowerCase();

    return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '',
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly,
        session: !!cookie.session,
        sameSite: sameSite,
        hostOnly: !!cookie.hostOnly,
        expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : null
    };
}

async function listCookies(url, filters) {
    const api = cookiesApi();
    if (!api || !api.getAll) return { ok: false, reason: 'the cookies permission is not available' };

    const target = cookieUrlFor(url);
    if (!target) return { ok: false, reason: 'no usable URL for this pane' };

    const options = { url: target };
    if (filters && filters.domain) options.domain = String(filters.domain);

    const found = await new Promise((resolve) => {
        try {
            api.getAll(options, (cookies) => resolve(cookies || []));
        } catch (error) {
            resolve([]);
        }
    });

    let cookies = found.map(describeCookie);
    if (filters && filters.name) {
        const wanted = String(filters.name);
        cookies = cookies.filter((cookie) => cookie.name === wanted || cookie.name.indexOf(wanted) !== -1);
    }

    cookies.sort((a, b) => (a.name === b.name ? a.domain.localeCompare(b.domain) : a.name.localeCompare(b.name)));
    return { ok: true, url: target, cookies: cookies };
}

async function setCookie(url, details) {
    const api = cookiesApi();
    if (!api || !api.set) return { ok: false, reason: 'the cookies permission is not available' };

    const target = cookieUrlFor(url);
    if (!target) return { ok: false, reason: 'no usable URL for this pane' };
    if (!details || details.name === undefined || details.name === '') {
        return { ok: false, reason: 'a cookie needs a name' };
    }

    const payload = {
        url: target,
        name: String(details.name),
        value: String(details.value == null ? '' : details.value)
    };

    if (details.path) payload.path = String(details.path);
    if (details.domain) payload.domain = String(details.domain);
    if (details.secure) payload.secure = true;
    if (details.httpOnly) payload.httpOnly = true;
    if (details.sameSite) payload.sameSite = String(details.sameSite);
    if (typeof details.expiresIn === 'number' && isFinite(details.expiresIn)) {
        payload.expirationDate = Math.floor(Date.now() / 1000) + Math.max(0, Math.floor(details.expiresIn));
    }

    return new Promise((resolve) => {
        try {
            api.set(payload, (cookie) => {
                if (!cookie) {
                    resolve({ ok: false, reason: (chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message) || 'the browser refused the cookie' });
                    return;
                }
                resolve({ ok: true, cookie: describeCookie(cookie) });
            });
        } catch (error) {
            resolve({ ok: false, reason: error && error.message ? error.message : String(error) });
        }
    });
}

async function removeCookie(url, name) {
    const api = cookiesApi();
    if (!api || !api.remove) return { ok: false, reason: 'the cookies permission is not available' };

    const target = cookieUrlFor(url);
    if (!target) return { ok: false, reason: 'no usable URL for this pane' };

    const list = await listCookies(target, { name: '' });
    if (!list.ok) return list;

    const victims = list.cookies.filter((cookie) => !name || cookie.name === String(name));
    if (!victims.length) {
        return { ok: true, removed: 0, names: [], reason: name ? 'no cookie with that name' : 'no cookies' };
    }

    const removed = [];

    for (const cookie of victims) {
        const urlForCookie = `http${cookie.secure ? 's' : ''}://${String(cookie.domain).replace(/^\./, '')}${cookie.path || '/'}`;
        const result = await new Promise((resolve) => {
            try {
                api.remove({ url: urlForCookie, name: cookie.name }, (detail) => resolve(detail || null));
            } catch (error) {
                resolve(null);
            }
        });
        if (result) removed.push(cookie.name);
    }

    return { ok: true, removed: removed.length, names: removed };
}

/** Netscape cookie-jar lines, which curl, wget and yt-dlp all accept. */
function cookiesToNetscape(cookies) {
    const lines = ['# Netscape HTTP Cookie File', '# Generated by BMUX', ''];

    cookies.forEach((cookie) => {
        const domain = cookie.hostOnly ? cookie.domain : (cookie.domain.charAt(0) === '.' ? cookie.domain : '.' + cookie.domain);
        const includeSubdomains = cookie.hostOnly ? 'FALSE' : 'TRUE';
        const secure = cookie.secure ? 'TRUE' : 'FALSE';
        const expires = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
        lines.push([domain, includeSubdomains, cookie.path || '/', secure, expires, cookie.name, cookie.value].join('\t'));
    });

    return lines.join('\n');
}

// --- housekeeping ---

async function pruneSessionLayouts() {
    const area = sessionArea();
    if (!area) return 0;

    const everything = await areaGet(area, null);
    const keys = Object.keys(everything).filter((key) => key.indexOf(TAB_LAYOUT_PREFIX) === 0);
    if (!keys.length) return 0;

    const tabs = await new Promise((resolve) => {
        try {
            chrome.tabs.query({}, (result) => resolve(result || []));
        } catch (e) {
            resolve([]);
        }
    });

    const live = new Set(tabs.map((tab) => String(tab.id)));
    const dead = keys.filter((key) => !live.has(key.slice(TAB_LAYOUT_PREFIX.length)));

    if (dead.length) await areaRemove(area, dead);
    return dead.length;
}

chrome.runtime.onStartup.addListener(() => {
    pruneSessionLayouts();
});

chrome.runtime.onInstalled.addListener(() => {
    pruneSessionLayouts();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    clearTabLayout(tabId);
});

// Clicking the toolbar icon activates BMUX in the active tab: the overlay appears
// with Control Mode on (the blue border). The popup is gone, so this fires.
if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener((tab) => {
        if (tab && tab.id !== undefined) {
            chrome.tabs.sendMessage(tab.id, { command: 'toggle-bmux' });
        }
    });
}

// The browser-level hotkey: Alt+Shift+B toggles Control Mode in the active tab.
chrome.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-bmux-mode') return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
            // One key, one state: show the overlay with Control Mode on, or hide it.
            chrome.tabs.sendMessage(tabs[0].id, { command: 'toggle-bmux' });
        }
    });
});

// --- message handling ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const url = sender && sender.tab ? sender.tab.url : '';

    switch (request && request.command) {
        // --- relay ---
        case 'relay-line':
            // A key pressed in a pane's iframe resolves to a command line there,
            // but only the top frame owns the overlay, so the line is relayed back
            // to the tab. The relay carries a command line, not an action name, so
            // the background never needs to know what commands exist.
            if (tabId !== null && tabId !== undefined) {
                chrome.tabs.sendMessage(tabId, { command: 'execute-line', line: request.line });
            }
            sendResponse({ status: 'relayed' });
            break;

        case 'prefix-detected':
            sendResponse({ status: 'ack' });
            break;

        case 'register-tab':
            sendResponse({ status: 'ok', tabId: tabId, url: url });
            break;

        // --- tab layout (session) ---
        case 'persist-load':
            Promise.all([getEnabled(), getInherit(), loadTabLayout(tabId)]).then(async ([enabled, inherit, loaded]) => {
                let snapshot = loaded.snapshot || null;
                let inheritedFrom = null;

                if (!snapshot && enabled && inherit) {
                    const template = await newestOtherLayout(tabId);
                    if (template) {
                        snapshot = template.snapshot;
                        inheritedFrom = template.tabId;
                    }
                }

                sendResponse({
                    status: 'ok',
                    enabled: enabled,
                    inherit: inherit,
                    tabId: tabId,
                    origin: originOf(url),
                    snapshot: snapshot,
                    inheritedFrom: inheritedFrom,
                    reason: loaded.reason || ''
                });
            });
            return true;

        case 'persist-save':
            saveTabLayout(tabId, request.snapshot).then((result) => {
                sendResponse(Object.assign({ status: result.ok ? 'ok' : 'skipped', tabId: tabId }, result));
            });
            return true;

        case 'persist-clear':
            clearTabLayout(tabId).then(() => sendResponse({ status: 'ok', tabId: tabId }));
            return true;

        case 'persist-set-inherit':
            setInherit(request.inherit).then((inherit) => {
                sendResponse({ status: 'ok', inherit: inherit });
            });
            return true;

        case 'persist-set-enabled':
            setEnabled(request.enabled).then(async (enabled) => {
                if (!enabled) await clearTabLayout(tabId);
                sendResponse({ status: 'ok', enabled: enabled });
            });
            return true;

        // --- toolbar configuration (the overlay's buttons) ---
        case 'toolbar-get':
            getToolbar().then((result) => {
                sendResponse(Object.assign({ status: result.ok ? 'ok' : 'error' }, result));
            });
            return true;

        case 'toolbar-set':
            setToolbar(request.buttons).then((result) => {
                sendResponse(Object.assign({ status: result.ok ? 'ok' : 'error' }, result));
            });
            return true;

        case 'toolbar-reset':
            resetToolbar().then((result) => {
                sendResponse(Object.assign({ status: 'ok' }, result));
            });
            return true;

        // --- frame identity and page-world eval ---
        case 'frame-id':
            sendResponse({
                status: 'ok',
                tabId: tabId,
                frameId: sender && sender.frameId !== undefined ? sender.frameId : 0
            });
            break;

        case 'exec-script':
            execInFrame(tabId, request.frameId, request.code).then((result) => {
                sendResponse(Object.assign({ status: result.ok ? 'ok' : 'error' }, result));
            });
            return true;

        // --- cookies (background broker: httpOnly needs the permission) ---
        case 'cookie-list':
            listCookies(request.url, request.filters).then((result) => {
                sendResponse(Object.assign({ status: result.ok ? 'ok' : 'error' }, result));
            });
            return true;

        case 'cookie-set':
            setCookie(request.url, request.details).then((result) => {
                sendResponse(Object.assign({ status: result.ok ? 'ok' : 'error' }, result));
            });
            return true;

        case 'cookie-remove':
            removeCookie(request.url, request.name).then((result) => {
                sendResponse(Object.assign({ status: result.ok ? 'ok' : 'error' }, result));
            });
            return true;

        // --- named layouts (local) ---
        case 'layout-save':
            saveNamedLayout(originOf(url), request.name, request.snapshot).then((result) => {
                sendResponse(Object.assign({ status: result.ok ? 'ok' : 'error', origin: originOf(url) }, result));
            });
            return true;

        case 'layout-list':
            listNamedLayouts(originOf(url)).then((layouts) => {
                sendResponse({ status: 'ok', origin: originOf(url), layouts: layouts });
            });
            return true;

        case 'layout-load':
            loadNamedLayout(originOf(url), request.name).then((result) => {
                sendResponse(Object.assign({ status: 'ok', origin: originOf(url) }, result));
            });
            return true;

        case 'layout-delete':
            deleteNamedLayouts(originOf(url), request.name).then((result) => {
                sendResponse(Object.assign({ status: 'ok', origin: originOf(url) }, result));
            });
            return true;

        default:
            sendResponse({ status: 'error', msg: 'Unknown command' });
    }

    return true; // keep the channel open for the async replies above
});
