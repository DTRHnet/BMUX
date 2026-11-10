/**
 * Frame-side inspection for BMUX (`list-storage`, `forms`, `scripts`,
 * `resources`, `outline`, `find-text`, `eval`).
 *
 * Loaded in every frame, before the other content scripts. The overlay lives in
 * the top frame, but a pane is an iframe: only the code running *inside* that
 * iframe can read its storage, walk its DOM or run its JavaScript. So the top
 * frame posts a request into the pane's window, this file answers it there, and
 * the answer is posted back to the parent. `postMessage` is allowed across
 * origins, which is why these commands work on panes BMUX cannot otherwise
 * inspect.
 *
 * Protocol
 *   parent  -> pane : { __bmuxInspect: <nonce>, kind: '<handler>', args: {…} }
 *   pane -> parent  : { __bmuxInspectReply: <nonce>, ok, result | error }
 *
 * Only requests whose `event.source` is this frame's parent are answered, and the
 * reply goes back to `event.source`, so a page cannot use this as an oracle for
 * anything it could not already read itself.
 *
 * `eval` runs in BMUX's isolated world: full DOM, storage and cookie access, but
 * *not* the page's own JavaScript variables. That is the price of not needing the
 * frame id; it is documented in docs/COMMAND_USAGE.md.
 */

(function () {
    'use strict';

    if (window.__bmuxInspectReady) return;
    window.__bmuxInspectReady = true;

    const MAX_RESULT_ITEMS = 200;
    const MAX_TEXT_NODES = 4000;
    const MAX_VALUE_DEPTH = 3;
    const MAX_STRING = 300;
    const HIGHLIGHT_ATTR = 'data-bmux-inspect-layer';
    const ACCENT = 'rgba(127, 208, 240, 0.85)';
    const FILL = 'rgba(127, 208, 240, 0.14)';

    function clampString(text, limit) {
        const value = String(text == null ? '' : text);
        return value.length > (limit || MAX_STRING) ? value.slice(0, limit || MAX_STRING) + '…' : value;
    }

    function oneLine(text) {
        return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    }

    /** A DOM node as a short selector-ish label. */
    function nodeLabel(node) {
        if (!node || !node.tagName) return String(node);
        const parts = [node.tagName.toLowerCase()];
        if (node.id) parts.push('#' + node.id);
        const classes = String(node.className || '').trim();
        if (classes) parts.push('.' + classes.split(/\s+/).slice(0, 2).join('.'));
        return '<' + parts.join('') + '>';
    }

    // --- highlighting (drawn inside the pane's own document) ----------------

    function ensureLayer() {
        let layer = document.querySelector('[' + HIGHLIGHT_ATTR + ']');

        if (!layer) {
            layer = document.createElement('div');
            layer.setAttribute(HIGHLIGHT_ATTR, '1');
            layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;' +
                'pointer-events:none;z-index:2147483646;';
            (document.documentElement || document.body).appendChild(layer);
        }

        while (layer.firstChild) layer.removeChild(layer.firstChild);
        return layer;
    }

    function boxFor(layer, left, top, width, height) {
        if (!(width > 0) || !(height > 0)) return;

        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;box-sizing:border-box;border:1px solid ' + ACCENT +
            ';background:' + FILL + ';';
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.width = width + 'px';
        box.style.height = height + 'px';
        layer.appendChild(box);
    }

    function highlightElements(elements) {
        const layer = ensureLayer();
        const list = Array.prototype.slice.call(elements || []).slice(0, MAX_RESULT_ITEMS);

        list.forEach((element) => {
            if (!element || typeof element.getBoundingClientRect !== 'function') return;
            const rect = element.getBoundingClientRect();
            boxFor(layer, rect.left, rect.top, rect.width, rect.height);
        });

        return layer.childElementCount;
    }

    function highlightRects(rects) {
        const layer = ensureLayer();
        (rects || []).slice(0, MAX_RESULT_ITEMS).forEach((rect) => {
            boxFor(layer, rect.left, rect.top, rect.width, rect.height);
        });
        return layer.childElementCount;
    }

    function clearHighlights() {
        const layer = document.querySelector('[' + HIGHLIGHT_ATTR + ']');
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
        return true;
    }

    // --- handlers -----------------------------------------------------------

    function storageArea(args) {
        const area = args.area === 'session' ? window.sessionStorage : window.localStorage;
        if (!area) throw new Error('that storage area is not available here');
        return area;
    }

    function handleStorage(args) {
        const area = storageArea(args);
        const action = String(args.action || 'list').toLowerCase();

        if (action === 'set') {
            const key = String(args.key == null ? '' : args.key);
            if (!key) throw new Error('set-storage needs a key');
            area.setItem(key, String(args.value == null ? '' : args.value));
            return { action: 'set', area: args.area === 'session' ? 'session' : 'local', key: key };
        }

        if (action === 'remove') {
            const key = String(args.key == null ? '' : args.key);
            area.removeItem(key);
            return { action: 'remove', area: args.area === 'session' ? 'session' : 'local', key: key };
        }

        if (action === 'clear') {
            area.clear();
            return { action: 'clear', area: args.area === 'session' ? 'session' : 'local', cleared: true };
        }

        let pattern = null;
        if (args.pattern) {
            try {
                pattern = new RegExp(String(args.pattern), 'i');
            } catch (error) {
                throw new Error('bad pattern: ' + error.message);
            }
        }

        const entries = [];
        for (let i = 0; i < area.length && entries.length < MAX_RESULT_ITEMS; i++) {
            const key = area.key(i);
            if (key == null) continue;
            if (pattern && !pattern.test(key)) continue;

            const value = area.getItem(key);
            const entry = { key: key, size: value == null ? 0 : String(value).length };
            if (!args.keysOnly) entry.value = clampString(value);
            entries.push(entry);
        }

        return {
            area: args.area === 'session' ? 'session' : 'local',
            origin: location.origin,
            total: area.length,
            entries: entries
        };
    }

    function handleForms(args) {
        const forms = Array.prototype.slice.call(document.querySelectorAll('form')).map((form) => ({
            action: form.getAttribute('action') || '',
            method: (form.getAttribute('method') || 'get').toLowerCase(),
            name: form.getAttribute('name') || '',
            id: form.id || '',
            fields: Array.prototype.slice.call(form.elements || []).slice(0, 100)
                .filter((element) => element.name || element.id)
                .map((element) => {
                    const type = String(element.type || element.tagName).toLowerCase();
                    const field = { name: element.name || element.id || '', type: type };
                    if (element.required) field.required = true;
                    if (element.type === 'password') field.value = '(hidden)';
                    else if (element.value) field.value = clampString(element.value, 60);
                    if (element.placeholder) field.placeholder = clampString(element.placeholder, 40);
                    return field;
                })
        }));

        // Inputs that live outside any <form> (SPAs do this constantly).
        const loose = Array.prototype.slice.call(document.querySelectorAll('input, textarea, select'))
            .filter((element) => !element.form)
            .slice(0, 50)
            .map((element) => ({
                name: element.name || element.id || '',
                type: String(element.type || element.tagName).toLowerCase()
            }));

        let boxes = 0;
        if (args.highlight) {
            boxes = highlightElements(document.querySelectorAll('form'));
        }

        return {
            title: document.title,
            url: location.href,
            count: forms.length,
            forms: forms,
            looseInputs: loose,
            highlighted: boxes
        };
    }

    function handleScripts(args) {
        const host = location.host;
        const all = Array.prototype.slice.call(document.querySelectorAll('script')).map((script) => {
            const src = script.src || '';
            let thirdParty = false;

            if (src) {
                try {
                    thirdParty = new URL(src, location.href).host !== host;
                } catch (error) {
                    thirdParty = true;
                }
            }

            return {
                src: src,
                type: script.type || '',
                inline: !src,
                size: src ? 0 : String(script.textContent || '').length,
                async: !!script.async,
                defer: !!script.defer,
                thirdParty: thirdParty
            };
        });

        const scripts = args.thirdPartyOnly ? all.filter((entry) => entry.thirdParty) : all;

        return {
            host: host,
            count: all.length,
            thirdParty: all.filter((entry) => entry.thirdParty).length,
            inline: all.filter((entry) => entry.inline).length,
            scripts: scripts.slice(0, MAX_RESULT_ITEMS)
        };
    }

    function handleResources(args) {
        const host = location.host;
        const entries = (window.performance && window.performance.getEntriesByType)
            ? window.performance.getEntriesByType('resource')
            : [];

        const groups = new Map();

        entries.forEach((entry) => {
            const type = entry.initiatorType || 'other';
            let thirdParty = false;

            try {
                thirdParty = new URL(entry.name, location.href).host !== host;
            } catch (error) {
                thirdParty = true;
            }

            let group = groups.get(type);
            if (!group) {
                group = { type: type, count: 0, bytes: 0, thirdParty: 0, urls: [] };
                groups.set(type, group);
            }

            group.count++;
            group.bytes += entry.transferSize || entry.encodedBodySize || 0;
            if (thirdParty) group.thirdParty++;
            if (group.urls.length < 10) group.urls.push(entry.name);
        });

        const grouped = Array.from(groups.values()).sort((a, b) => b.count - a.count);

        return {
            host: host,
            url: location.href,
            total: entries.length,
            groups: grouped,
            fallback: entries.length ? null : {
                images: document.images.length,
                stylesheets: document.styleSheets.length,
                scripts: document.querySelectorAll('script[src]').length
            }
        };
    }

    function handleOutline(args) {
        const headings = Array.prototype.slice.call(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
            .slice(0, MAX_RESULT_ITEMS)
            .map((element) => ({
                level: Number(element.tagName.charAt(1)),
                text: clampString(oneLine(element.textContent), 120)
            }));

        const landmarkSelector = 'main, nav, header, footer, aside, article, ' +
            '[role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';

        const landmarks = Array.prototype.slice.call(document.querySelectorAll(landmarkSelector))
            .slice(0, 100)
            .map((element) => ({
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute('role') || '',
                label: clampString(element.getAttribute('aria-label') || element.id || '', 60)
            }));

        // A heading that skips a level (h1 -> h3) is the usual outline smell.
        const jumps = [];
        headings.forEach((heading, index) => {
            const previous = headings[index - 1];
            if (previous && heading.level > previous.level + 1) {
                jumps.push('h' + previous.level + ' → h' + heading.level + ' at "' + heading.text + '"');
            }
        });

        return {
            title: document.title,
            url: location.href,
            headings: headings,
            h1Count: headings.filter((heading) => heading.level === 1).length,
            landmarks: landmarks,
            jumps: jumps
        };
    }

    function handleFindText(args) {
        const query = String(args.query == null ? '' : args.query);

        if (args.clear) {
            clearHighlights();
            return { cleared: true };
        }

        if (!query.trim()) throw new Error('find-text needs something to search for');

        const needle = query.toLowerCase();
        const matches = [];
        let scanned = 0;
        const rects = [];

        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;

                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;

                const tag = parent.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') {
                    return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let node = walker.nextNode();
        while (node && scanned < MAX_TEXT_NODES && matches.length < MAX_RESULT_ITEMS) {
            scanned++;
            const text = node.nodeValue;
            const lowered = text.toLowerCase();
            let index = lowered.indexOf(needle);
            let occurrences = 0;

            while (index !== -1) {
                occurrences++;
                index = lowered.indexOf(needle, index + needle.length);
            }

            if (occurrences) {
                matches.push({
                    text: clampString(oneLine(text), 140),
                    occurrences: occurrences,
                    tag: node.parentElement ? node.parentElement.tagName.toLowerCase() : ''
                });

                // One box per text node, not per occurrence: the text is one run.
                const range = document.createRange();
                try {
                    range.selectNodeContents(node);
                    const rect = range.getBoundingClientRect();
                    if (rect && (rect.width || rect.height)) rects.push(rect);
                } catch (error) {
                    // A detached node: skip its box, keep the text match.
                }
            }

            node = walker.nextNode();
        }

        const boxes = args.highlight === false ? 0 : highlightRects(rects);

        return {
            query: query,
            nodesScanned: scanned,
            nodesMatched: matches.length,
            occurrences: matches.reduce((total, match) => total + match.occurrences, 0),
            boxes: boxes,
            matches: matches
        };
    }

    /**
     * This frame's id and tab id, so the top frame can ask the background to run
     * `chrome.scripting.executeScript` in exactly this frame (`eval`).
     */
    function handleFrameId() {
        return new Promise((resolve, reject) => {
            if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                reject(new Error('chrome.runtime is not available in this frame'));
                return;
            }

            const timer = setTimeout(() => reject(new Error('the background did not identify this frame')), 1200);

            try {
                chrome.runtime.sendMessage({ command: 'frame-id' }, (reply) => {
                    clearTimeout(timer);
                    if (!reply || reply.status !== 'ok') {
                        reject(new Error('the background refused to identify this frame'));
                        return;
                    }
                    resolve({ frameId: reply.frameId, tabId: reply.tabId });
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    const HANDLERS = {
        storage: handleStorage,
        forms: handleForms,
        scripts: handleScripts,
        resources: handleResources,
        outline: handleOutline,
        'find-text': handleFindText,
        'frame-id': handleFrameId
    };

    function reply(source, payload) {
        try {
            source.postMessage(payload, '*');
        } catch (error) {
            // The parent went away (pane removed mid-request): nothing to do.
        }
    }

    window.addEventListener('message', function (event) {
        const data = event.data;
        if (!data || typeof data !== 'object' || !data.__bmuxInspect) return;
        if (event.source !== window.parent) return;

        const nonce = data.__bmuxInspect;
        const kind = String(data.kind || '');

        const fail = (error) => reply(event.source, {
            __bmuxInspectReply: nonce,
            ok: false,
            error: error && error.message ? error.message : String(error)
        });

        try {
            const handler = HANDLERS[kind];
            if (!handler) throw new Error('unknown inspection "' + kind + '"');

            // Handlers may answer now (DOM reads) or later (frame-id).
            Promise.resolve(handler(data.args || {}))
                .then((result) => reply(event.source, { __bmuxInspectReply: nonce, ok: true, result: result }))
                .catch(fail);
        } catch (error) {
            fail(error);
        }
    }, false);

    // For the verification harness and for anyone debugging a handler directly.
    window.__bmuxInspect = {
        handlers: HANDLERS,
        highlightElements: highlightElements,
        clearHighlights: clearHighlights
    };
})();
