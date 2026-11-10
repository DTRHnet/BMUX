/**
 * Settings: the overlay's toolbar buttons.
 *
 * `content/commands.js` is loaded into this page, so the editor validates against
 * the *real* registry: a button can only be added when its command starts with a
 * name that exists, and the page explains the usage of whichever command is typed.
 *
 * The list itself is owned by the background (`toolbar-get` / `toolbar-set` /
 * `toolbar-reset`), the same place every other persisted thing lives.
 */

(function () {
    'use strict';

    const registry = typeof BMUX_COMMANDS === 'undefined' ? {} : BMUX_COMMANDS;

    const list = document.getElementById('toolbar-list');
    const preview = document.getElementById('preview');
    const empty = document.getElementById('empty');
    const addButton = document.getElementById('add');
    const newLabel = document.getElementById('new-label');
    const newCommand = document.getElementById('new-command');
    const hint = document.getElementById('command-hint');
    const errorLine = document.getElementById('error');
    const catalog = document.getElementById('catalog');
    const commandCount = document.getElementById('command-count');
    const options = document.getElementById('command-options');
    const status = document.getElementById('status');

    let buttons = [];
    let saved = [];

    function hasCommand(name) {
        return Object.prototype.hasOwnProperty.call(registry, name);
    }

    /** The command name a line starts with (`list-cookies -j` -> `list-cookies`). */
    function commandName(line) {
        return String(line || '').trim().split(/\s+/)[0] || '';
    }

    function definitionOf(line) {
        const name = commandName(line);
        return hasCommand(name) ? registry[name] : null;
    }

    function say(text, kind) {
        status.textContent = text;
        status.className = 'status' + (kind ? ' ' + kind : '');
    }

    function showError(text) {
        if (!text) {
            errorLine.hidden = true;
            errorLine.textContent = '';
            return;
        }
        errorLine.hidden = false;
        errorLine.textContent = text;
    }

    // --- rendering -------------------------------------------------------

    function renderPreview() {
        preview.textContent = '';

        buttons.forEach((button) => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = button.label;
            chip.title = button.command;
            preview.appendChild(chip);
        });
    }

    function renderList() {
        list.textContent = '';
        empty.hidden = buttons.length > 0;

        buttons.forEach((button, index) => {
            const row = document.createElement('tr');
            row.dataset.command = button.command;

            const number = document.createElement('td');
            number.className = 'col-num';
            number.textContent = String(index + 1);

            const labelCell = document.createElement('td');
            labelCell.className = 'label';
            labelCell.textContent = button.label;

            const commandCell = document.createElement('td');
            commandCell.className = 'command';
            commandCell.textContent = button.command;

            const definition = definitionOf(button.command);
            if (!definition) {
                commandCell.classList.add('invalid');
                const why = document.createElement('span');
                why.className = 'why';
                why.textContent = `unknown command "${commandName(button.command)}" — it will be skipped`;
                commandCell.appendChild(why);
            }

            const actions = document.createElement('td');
            const group = document.createElement('div');
            group.className = 'row-actions';

            const up = document.createElement('button');
            up.className = 'move-up';
            up.textContent = '↑';
            up.title = 'Move up';
            up.disabled = index === 0;
            up.addEventListener('click', () => move(index, -1));

            const down = document.createElement('button');
            down.className = 'move-down';
            down.textContent = '↓';
            down.title = 'Move down';
            down.disabled = index === buttons.length - 1;
            down.addEventListener('click', () => move(index, 1));

            const remove = document.createElement('button');
            remove.className = 'remove';
            remove.textContent = '✕';
            remove.title = 'Remove this button';
            remove.addEventListener('click', () => {
                buttons.splice(index, 1);
                renderAll();
                say('Removed — Save to keep it', '');
            });

            group.appendChild(up);
            group.appendChild(down);
            group.appendChild(remove);
            actions.appendChild(group);

            row.appendChild(number);
            row.appendChild(labelCell);
            row.appendChild(commandCell);
            row.appendChild(actions);
            list.appendChild(row);
        });
    }

    function renderCatalog() {
        catalog.textContent = '';
        const names = Object.keys(registry).sort();
        commandCount.textContent = String(names.length);

        names.forEach((name) => {
            const definition = registry[name];
            const item = document.createElement('button');
            item.className = 'catalog-item';
            item.textContent = name;
            item.title = definition.usage ? `${definition.usage}\n\n${definition.description || ''}` : name;
            item.addEventListener('click', () => {
                newCommand.value = name;
                if (!newLabel.value.trim()) newLabel.value = name;
                describeTypedCommand();
                newCommand.focus();
            });
            catalog.appendChild(item);

            const option = document.createElement('option');
            option.value = name;
            option.label = definition.description || name;
            options.appendChild(option);
        });
    }

    function renderAll() {
        renderList();
        renderPreview();
    }

    // --- editing ---------------------------------------------------------

    function move(index, step) {
        const target = index + step;
        if (target < 0 || target >= buttons.length) return;
        const moved = buttons.splice(index, 1)[0];
        buttons.splice(target, 0, moved);
        renderAll();
        say('Reordered — Save to keep it', '');
    }

    function describeTypedCommand() {
        const value = newCommand.value.trim();
        if (!value) {
            hint.textContent = 'Start typing a command name; only real commands can be added.';
            hint.className = 'hint';
            showError('');
            return;
        }

        const name = commandName(value);
        const definition = definitionOf(value);

        if (!definition) {
            hint.textContent = `"${name}" is not a command. Use help in the overlay to see them all.`;
            hint.className = 'error';
            showError(`Unknown command "${name}" — nothing was added.`);
            return;
        }

        showError('');
        hint.className = 'hint';
        hint.textContent = `Usage: ${definition.usage || name}` +
            (definition.description ? ` — ${definition.description}` : '');
    }

    function addButtonFromForm() {
        const label = newLabel.value.trim().slice(0, 24);
        const command = newCommand.value.trim().slice(0, 120);

        if (!label) {
            showError('A button needs a label.');
            return;
        }
        if (!command) {
            showError('A button needs a command.');
            return;
        }

        const name = commandName(command);
        if (!definitionOf(command)) {
            showError(`Unknown command "${name}" — it is not in the registry, so the button would do nothing.`);
            return;
        }
        if (buttons.some((button) => button.command === command && button.label === label)) {
            showError('That button already exists.');
            return;
        }
        if (buttons.length >= 24) {
            showError('The toolbar is full (24 buttons).');
            return;
        }

        buttons.push({ label: label, command: command });
        newLabel.value = '';
        newCommand.value = '';
        showError('');
        describeTypedCommand();
        renderAll();
        say(`Added "${label}" — Save to keep it`, '');
    }

    // --- persistence -----------------------------------------------------

    function send(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (reply) => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, reason: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(reply || { ok: false, reason: 'the background did not answer' });
                });
            } catch (error) {
                resolve({ ok: false, reason: error && error.message ? error.message : String(error) });
            }
        });
    }

    async function load() {
        const reply = await send({ command: 'toolbar-get' });
        if (!reply || reply.status !== 'ok') {
            say(`Could not load the toolbar: ${(reply && reply.reason) || 'unknown error'}`, 'error');
            buttons = [];
        } else {
            buttons = (reply.buttons || []).map((button) => ({ label: button.label, command: button.command }));
            say(reply.source === 'custom' ? 'Loaded your toolbar' : 'Loaded the default toolbar', '');
        }

        saved = buttons.map((button) => ({ label: button.label, command: button.command }));
        renderAll();
    }

    async function save() {
        const reply = await send({ command: 'toolbar-set', buttons: buttons });
        if (!reply || reply.status !== 'ok') {
            say(`Not saved: ${(reply && reply.reason) || 'unknown error'}`, 'error');
            return;
        }

        buttons = (reply.buttons || []).map((button) => ({ label: button.label, command: button.command }));
        saved = buttons.map((button) => ({ label: button.label, command: button.command }));
        renderAll();
        say('Saved — open BMUX to see the new toolbar', 'ok');
    }

    async function loadDefaults() {
        const reply = await send({ command: 'toolbar-reset' });
        if (!reply || reply.status !== 'ok') {
            say(`Could not load defaults: ${(reply && reply.reason) || 'unknown error'}`, 'error');
            return;
        }

        buttons = (reply.buttons || []).map((button) => ({ label: button.label, command: button.command }));
        renderAll();
        say('Defaults loaded — Save to keep them', '');
    }

    // --- wiring ----------------------------------------------------------

    if (addButton) addButton.addEventListener('click', addButtonFromForm);
    if (newCommand) newCommand.addEventListener('input', describeTypedCommand);
    if (newCommand) newCommand.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') addButtonFromForm();
    });

    document.getElementById('save').addEventListener('click', save);
    document.getElementById('reset').addEventListener('click', loadDefaults);
    document.getElementById('reload').addEventListener('click', load);

    renderCatalog();
    load();
})();
