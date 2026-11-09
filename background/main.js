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

const SNAPSHOT_VERSION = 1;

const PERSIST_ENABLED_KEY = 'persist:enabled';
const TAB_LAYOUT_PREFIX = 'layout:tab:';
const NAMED_PREFIX = 'layout:named:';

// Validation caps, applied on both write and read: a snapshot outside them is
// rejected whole rather than partially applied.
const MAX_PANES = 12;
const MAX_DEPTH = 32;
const MAX_NAMED_LAYOUTS = 30;
const MAX_SNAPSHOT_BYTES = 64 * 1024;

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

function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return { ok: false, reason: 'not an object' };
    }
    if (snapshot.version !== SNAPSHOT_VERSION) {
        return { ok: false, reason: `unknown version ${snapshot.version}` };
    }

    let bytes = 0;
    try {
        bytes = JSON.stringify(snapshot).length;
    } catch (e) {
        return { ok: false, reason: 'not serialisable' };
    }
    if (bytes > MAX_SNAPSHOT_BYTES) {
        return { ok: false, reason: `${bytes} bytes is over the ${MAX_SNAPSHOT_BYTES} byte cap` };
    }

    const layout = snapshot.layout;
    if (!layout || typeof layout !== 'object') {
        return { ok: false, reason: 'no layout tree' };
    }

    const panes = countPanes(layout);
    if (panes < 1) return { ok: false, reason: 'no panes' };
    if (panes > MAX_PANES) {
        return { ok: false, reason: `${panes} panes is over the ${MAX_PANES} cap` };
    }

    const depth = depthOf(layout);
    if (depth > MAX_DEPTH) {
        return { ok: false, reason: `tree depth ${depth} is over the ${MAX_DEPTH} cap` };
    }

    if (!isValidNode(layout)) {
        return { ok: false, reason: 'malformed tree' };
    }

    return { ok: true, panes: panes };
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
        ? { snapshot: snapshot, savedAt: Date.now(), fallback: true }
        : { snapshot: snapshot, savedAt: Date.now() };

    await areaSet(area, { [tabLayoutKey(tabId)]: record });
    return { ok: true, panes: check.panes, fallback: fallback };
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

    return { ok: true, snapshot: record.snapshot };
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
                panes: record.panes || countPanes(record.snapshot && record.snapshot.layout)
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
    const record = { savedAt: Date.now(), panes: check.panes, snapshot: snapshot };
    await areaSet(local, { [namedKey(origin, clean)]: record });

    // Keep the newest MAX_NAMED_LAYOUTS for this origin.
    const all = await listNamedLayouts(origin);
    if (all.length > MAX_NAMED_LAYOUTS) {
        const stale = all.slice(MAX_NAMED_LAYOUTS).map((entry) => namedKey(origin, entry.name));
        await areaRemove(local, stale);
    }

    return { ok: true, name: clean, panes: check.panes };
}

async function loadNamedLayout(origin, name) {
    const clean = String(name || '').trim();
    if (!clean) return { ok: false, reason: 'no name' };

    const stored = await areaGet(localArea(), [namedKey(origin, clean)]);
    const record = stored[namedKey(origin, clean)];
    if (!record) return { ok: true, snapshot: null, reason: `no layout named "${clean}"` };

    const check = validateSnapshot(record.snapshot);
    if (!check.ok) return { ok: true, snapshot: null, reason: check.reason };

    return { ok: true, snapshot: record.snapshot, name: clean };
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

// The browser-level hotkey: Alt+Shift+B toggles Control Mode in the active tab.
chrome.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-bmux-mode') return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { command: 'toggle-control-mode' });
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
            Promise.all([getEnabled(), loadTabLayout(tabId)]).then(([enabled, loaded]) => {
                sendResponse({
                    status: 'ok',
                    enabled: enabled,
                    tabId: tabId,
                    origin: originOf(url),
                    snapshot: loaded.snapshot || null,
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

        case 'persist-set-enabled':
            setEnabled(request.enabled).then(async (enabled) => {
                if (!enabled) await clearTabLayout(tabId);
                sendResponse({ status: 'ok', enabled: enabled });
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
