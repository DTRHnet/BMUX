# BMUX - Adding Commands

## Overview

Every BMUX command is defined once, in `content/commands.js`, in the
`BMUX_COMMANDS` object. That registry is the single source of truth:

- the toolbar buttons run command lines,
- the debug console, the `:` line and each pane's input parse whatever you type,
- Control Mode and `Ctrl+b` keys are mapped to command lines in `BMUX_KEYBINDINGS`.

`content/main.js` holds no command definitions, no help text and no
key-to-action switch. It parses a line, looks the name up (own-property lookup, so
`constructor` is not a command), and calls `execute` with an `api` object.

```
typed line / button / key
      │
      ▼
content/main.js  runCommand(line)
      │  BMUX_COMMANDS[name].execute(api, args)
      ▼
content/commands.js  the command
```

## Command shape

```javascript
'command-name': {
    scope: 'overlay',                 // 'overlay' or 'pane'
    description: 'What this does',    // one line, shown by help
    usage: 'command-name [arguments]',
    execute: async function (api, args) {
        // api.client : the top-frame BMUXClient (layout, pane and overlay primitives)
        // api.pane   : the pane this command was invoked for, or the active pane
        // api.log    : append a line to the debug console
        // args       : array of arguments, already split on whitespace

        return 'Text to display';
    }
}
```

Rules that keep commands consistent with the rest of BMUX:

1. **`scope: 'overlay'`** for commands that manage the whole overlay. They must
   work when there is no pane at all.
2. **`scope: 'pane'`** for commands that act on one pane. Check `api.pane` first
   and return an error string if it is missing.
3. **Return a string.** It is displayed by whichever entry point ran the command.
   Returning `''` (or nothing) means "no output".
4. **Never throw for bad input.** Return an error or usage line. The dispatcher
   catches throws, but a clear message is better than `Error: undefined`.
5. **`usage` starts with the command name**, because `help` prints it verbatim.
6. **Add `hidden: true`** for a command that exists for scripting or aliases and
   should not appear in `help` (`y` and `n` are hidden aliases of `yes` / `no`).
6. **Do not move pane elements in the DOM.** Reparenting an iframe reloads the
   page inside it. Use the layout primitives (`api.client.splitWindow`,
   `killPane`, `applyLayout`, `swapPanes`, `rotatePanes`, `setPaneSize`,
   `zoomPane`) instead of touching the DOM structure.
7. **Do not restyle the page inside a pane.** Anything you draw for the user
   (like the `filter` boxes) should be sibling overlays you own and clean up:
   `filterPane` appends one `[data-bmux-filter-layer]` to the pane document and
   `clearFilter` takes it away. Never wrap or mutate the page's own elements.

### Drawing an overlay into a pane

`filter` is the worked example: `filterPane` creates a layer plus one box per
match in the pane's document, positions each box in document coordinates
(`getBoundingClientRect() + scroll`), styles them through an injected `<style>`,
and attaches `mousemove`/`mouseleave`/`keydown` listeners to that document so the
pane's status line can follow the pointer and `Esc` can clear the overlay. The
listeners are stored on the state object and removed by `clearFilter`, and the
whole state is dropped when the pane navigates (`iframe` load), is killed, or the
overlay resets.

## Adding a pane command

```javascript
'elements': {
    scope: 'pane',
    description: 'Count elements matching a selector',
    usage: 'elements <selector>',
    execute: function (api, args) {
        const pane = api.pane;
        if (!pane) return 'Error: No pane';

        if (args.length === 0) {
            return 'Error: Usage: elements <selector>';
        }

        const iframe = pane.querySelector('iframe');
        if (!iframe) return 'Error: No iframe found';

        const doc = safeGetIframeDocument(iframe);   // helper in commands.js
        if (!doc) return 'Error: Cross-origin content';

        let found;
        try {
            found = doc.querySelectorAll(args[0]);
        } catch (e) {
            return `Error: Invalid selector "${args[0]}"`;
        }

        return `Found ${found.length} element(s) matching ${args[0]}`;
    }
}
```

That is the whole change: the command is now available from the console, the `:`
line, every pane input, and `help`.

## Adding an overlay command

Overlay commands use the client primitives rather than touching the DOM:

```javascript
'spread-panes': {
    scope: 'overlay',
    description: 'Give every pane the same share of its parent split',
    usage: 'spread-panes',
    execute: function (api) {
        const client = api.client;
        const panes = client.getPanes();
        if (panes.length < 2) return 'Error: Split first';

        panes.forEach((pane) => client.setPaneSize(pane, 1 / panes.length));
        return `Evened out ${panes.length} panes`;
    }
}
```

### Client primitives available on `api.client`

**Panes and identity**

| Method | Returns |
|--------|---------|
| `getPanes()` | Array of pane elements in layout order |
| `getActivePane()` | The pane with the `active` class, or the first pane |
| `getPaneId(pane)` | The pane's id string, e.g. `%2` |
| `getPaneNumber(pane)` | The pane's 1-based layout number |
| `getPaneUrl(pane)` | The pane's current URL (cross-origin safe) |
| `getPaneTitle(pane)` | Custom title, else page title, else URL |
| `renamePane(pane, title)` | Set or clear (`-`) the footer title |
| `getPaneRect(pane)` | Fractional rect `{ x, y, w, h }` in 0..1 |
| `getPaneSizeLabel(pane)` | Human size, e.g. `30%x100%` |
| `findPaneByToken(token)` | Pane from `2` or `%2`, or `null` |
| `setActivePane(pane)` | Focus a pane, refresh badges and status bar |
| `lastPane()` / `cyclePane(step)` | Previous pane / next or previous pane |
| `isZoomed(pane)` | Whether that pane is zoomed |

**Layout operations** (these never reload a page)

| Method | Returns |
|--------|---------|
| `splitWindow(direction, opts)` | `{ ok, pane }`; `opts = { size, before, keepFocus, url }` |
| `killPane(pane)` | `{ ok, pane }` or `{ ok: false, message }` (last pane refused) |
| `resizePane(pane, direction, percent)` | Moves the adjacent boundary |
| `setPaneSize(pane, share)` | Sets the pane's share of its parent split |
| `zoomPane(pane)` | Toggle zoom; `{ ok, zoomed }` |
| `applyLayout(name)` | `even-horizontal`, `even-vertical`, `main-vertical`, `main-horizontal`, `tiled` |
| `nextLayout()` | Cycle to the next preset |
| `swapPanes(a, b)` | Trade two panes' positions |
| `rotatePanes(reverse)` | Move every pane one slot |
| `displayPanes()` | Show pane numbers for two seconds |
| `filterPane(pane, selector, { max })` | Box matches inside a same-origin pane; returns `{ ok, matched, shown }` |
| `refreshFilter(pane)` | Re-measure and redraw that pane's boxes |
| `clearFilter(pane)` / `clearAllFilters()` | Remove the boxes and the status line |
| `hasActiveFilters()` | Whether any pane is currently boxed |
| `setPaneStatus(pane, text, mode)` | Write the pane's status segment (`'filtering'`/`'hovering'`) |
| `collectFilterMatches(pane, selector, test)` | Query a pane (plus an optional predicate) without drawing; `{ ok, doc, elements }` |
| `requestFilterConfirm(pane, selector, opts)` | Ask for a yes/no answer before drawing |
| `resolveFilterConfirm(accept)` | Answer that prompt (what `yes` / `no` call) |
| `hasPendingConfirm()` | Whether a prompt is waiting |
| `appendPaneOutput(pane, text, kind)` | Append a block to a pane console (`'command'` or `'result'`) |
| `setPaneConsoleOpen(pane, open)` / `togglePaneConsole(pane)` | Open, close or toggle the pane console |
| `clearPaneConsole(pane)` | Empty the pane console scrollback |
| `setPaneConsoleHeight(pane, px)` | Set the console height (clamped to 40px … 70% of the pane) |
| `describeElement(element)` | `TAG#id.class "snippet"` for a matched element |
| `focusDirection(dir)` | `{ ok, pane, wrapped }` or `{ ok: false, message }` |
| `newWindow()` | Reset to a single pane |
| `toggle()` | Hide or show the overlay |
| `setControlMode(on)` | Set Control Mode |
| `showCommandMode()` / `hideCommandMode()` | Open/close the `:` line |
| `log(message)` | Append to the debug console |
| `ask({ question, details, choices })` | Ask a question in a card; resolves `{ choice, text, cancelled }` |
| `askText({ question, placeholder })` | Ask for a line of text; resolves `{ text, cancelled }` |
| `answerOpenPrompt(choiceId, pane)` | Programmatically answer the open prompt |
| `hasOpenPrompt(pane)` | Whether a prompt is open |
| `scheduleSave()` / `saveNow(reason)` | Persist the layout (debounced / immediately) |
| `serializeLayout()` | The current layout as a snapshot object |
| `applySnapshot(snapshot)` | Rebuild the overlay from a snapshot |
| `setPersistEnabled(on)`, `saveNamedLayout(name)`, `listNamedLayouts()`, `restoreNamedLayout(name)`, `deleteNamedLayout(name)` | The persistence commands' client side |

## Adding a filter preset

Presets live in `BMUX_FILTER_PRESETS` in `content/commands.js` and are pure data:

```javascript
const BMUX_FILTER_PRESETS = {
    // ...
    'cards': {
        selector: '.card, article',
        description: 'cards and article blocks',
        variants: {
            // A variant may narrow the selector...
            'tall': { description: 'cards taller than 400px', selector: '.card', test: (el) => el.offsetHeight > 400 },
            // ...or change it outright.
            'links': { description: 'links inside cards', selector: '.card a[href]' }
        }
    }
};
```

`filter cards tall` then means "a `.card` taller than 400px", which no single CSS
selector expresses. A `test(element, doc, view)` predicate runs inside the pane
document, and returning `false` (or throwing) simply drops the element. Add the
preset, reload, and both `filter cards` and `filter --presets` pick it up.

## Asking the user

Commands can ask questions and get clickable answers. `runCommand` awaits the
command, so just `await api.ask(...)` and carry on:

```javascript
'delete-comments': {
    scope: 'pane',
    description: 'Delete every comment element after confirming',
    usage: 'delete-comments',
    execute: async function (api, args) {
        const pane = api.pane;
        if (!pane) return 'Error: No pane';

        const doc = safeGetIframeDocument(pane.querySelector('iframe'));
        if (!doc) return 'Error: Cross-origin content';

        const comments = Array.from(doc.querySelectorAll('.comment'));
        if (!comments.length) return 'No comments here';

        const answer = await api.ask({
            question: `Delete ${comments.length} comment(s)?`,
            details: '.comment elements in this pane',
            choices: [
                { id: 'yes', label: 'Delete them', primary: true },
                { id: 'no', label: 'Keep them' }
            ]
        });

        if (answer.cancelled || answer.choice !== 'yes') {
            return 'Cancelled: nothing deleted';
        }

        comments.forEach((element) => element.remove());
        return `Deleted ${comments.length} comment(s)`;
    }
}
```

Text questions use the same card:

```javascript
const asked = await api.askText({ question: 'Keep only matches containing…', placeholder: 'price' });
if (asked.cancelled) return 'Nothing typed';
const needle = asked.text.toLowerCase();
```

What you get for free:

- a card above the pane's footer with real buttons, digit shortcuts (`1`…`9`),
  `Enter` for the primary choice, `y` / `n` on yes/no cards, and `Esc` to cancel;
- `yes` / `no` commands answer the open prompt, mapping a missing choice onto the
  primary button;
- the prompt is cancelled for you when the pane is killed, navigates, or the
  overlay resets, so an awaited command can never hang;
- yes/no cards time out after 15 seconds (resolved as cancelled); text cards wait;
- one prompt per pane — a newer `ask` replaces the older one.

Reach for `api.ask` whenever a command would otherwise need a second command to
finish its job (the filter refinement loop works exactly this way).

## Chaining commands

Any command can be chained from the UI with `;` — you get the behaviour for free by
returning a string like every other command. Two things to keep in mind:

- Segments run **awaited**, so an `await api.ask(...)` in one segment blocks the
  next segment until it is answered. Do not leave a prompt un-answered forever in
  a chain; give it a `timeout`.
- A failure (an `Error: …` string) does not stop the chain. If a command must stop
  a chain, that is not supported yet — return a message that tells the user to
  re-run the rest.

## Persisting layout changes

Layouts are saved automatically: `renderLayout()` calls `scheduleSave()` at the
end, so any command that goes through the layout primitives (`splitWindow`,
`killPane`, `applyLayout`, `swapPanes`, `rotatePanes`, `setPaneSize`, `zoomPane`)
is persisted without doing anything. The same is true for `setActivePane`,
`renamePane` and the pane-console setters, which save explicitly.

If your command changes the layout **without** going through those primitives —
say it mutates `client.layout` itself — call the hook yourself:

```javascript
api.client.scheduleSave();        // debounced, 400ms
await api.client.saveNow('mine'); // immediate, for commands that must not lose it
```

Rules the persister enforces (in `background/main.js`, on write *and* read): version
`1`, a well-formed tree of `leaf`/`split` nodes, split ratios inside 1–99%, panes as
`{ id, url, title? }`, at most 12 panes, depth at most 32, at most 64 KB. A command
that produces a bigger or stranger layout will not have it restored — keep layouts
within those limits.

The snapshot shape, if you need to read one:

```javascript
{
  version: 1, savedAt: 0, origin: 'https://example.com', url: 'https://example.com/',
  activeId: '%2', zoomedId: null, nextPaneId: 3,
  consoles: { '%1': { open: true, height: 180 } },
  layout: { kind: 'split', direction: 'row', ratio: 0.3,
            first:  { kind: 'leaf', pane: { id: '%1', url: '…', title: 'Docs' } },
            second: { kind: 'leaf', pane: { id: '%2', url: '…' } } }
}
```

## Adding a key binding

Keys are data, not code. Add an entry to `BMUX_KEYBINDINGS` in
`content/commands.js`:

```javascript
const BMUX_KEYBINDINGS = {
    control: {
        // ...
        'v': 'split-window -v -l 70%'
    },
    prefix: {
        // ...
        'v': 'split-window -v -l 70%'
    }
};
```

`control` is used in Control Mode (Alt+Shift+B), `prefix` after `Ctrl+b`. The value
is a command line, so it can carry arguments. Alt combinations are written
`Alt+ArrowLeft`; the space bar is written `Space`. Keys that are not listed are
swallowed by Control Mode, which is what stops the page from seeing them. Typing
in a console or pane input always takes precedence over bindings.

## Built-in commands

Overlay scope:

| Command | Description |
|---------|-------------|
| `help` | List every command, grouped by scope |
| `list-panes [-j]` | Number, id, size, marker, title, URL |
| `focus-pane <n\|%id\|dir>` | Focus by number, id, or direction (wraps) |
| `last-pane` | Focus the previous pane |
| `cycle-pane [next\|prev]` | Next / previous pane in layout order |
| `split-window [-h\|-v] [-l size] [-b] [-d]` | Split the active pane |
| `kill-pane [target]` | Close a pane (last pane refused) |
| `resize-pane [-L\|-R\|-U\|-D n] [-x size] [-Z]` | Resize or zoom |
| `select-layout <name>` / `next-layout` | Layout presets |
| `swap-pane <a> [b]` / `rotate-window [-r]` | Reorder panes |
| `display-panes` | Show numbers, pick with a digit |
| `new-window` | Reset the overlay to one pane |
| `detach` | Hide or show the overlay |
| `control-mode [on\|off\|toggle]` | Enter or leave Control Mode |
| `command-prompt` | Open the `:` line |

Pane scope:

| Command | Description |
|---------|-------------|
| `source` | Show the pane's HTML in a console view |
| `restore` | Return from console view to browser view |
| `filter <selector\|preset> [-n max] [-y]` / `filter -l` / `filter -c` / `filter --presets` | Box matches in the pane, name them on hover, list only, clear, or list the preset vocabulary |
| `yes` / `no` (`y` / `n` hidden) | Answer a filter confirmation prompt |
| `persist [on\|off\|status]` | Per-tab auto-restore switch |
| `save-layout [name]` / `restore-layout <name>` / `list-layouts` / `delete-layout <name\|--all>` | Named layouts |
| `log [toggle\|on\|off\|clear\|size px]` | Open, close, resize or clear the pane console |
| `capture-pane [-n lines]` | Print the pane's visible text |
| `rename-pane <title\|->` | Set or clear the footer title |
| `url [new-url]` | Show or change the pane URL |
| `reload` | Reload the pane |
| `clear` | Clear the pane's output area |

## Accessing Pane Contents

### Get the iframe

```javascript
const iframe = pane.querySelector('iframe');
```

### Access the iframe document (same-origin only)

Use the helpers already in `content/commands.js` — never touch
`iframe.contentDocument` directly, or you will throw on cross-origin frames:

```javascript
const doc = safeGetIframeDocument(iframe);   // null when cross-origin
if (!doc) return 'Error: Cross-origin restriction';

const url = safeGetIframeUrl(iframe);        // falls back to the src attribute
if (!isIframeAccessible(iframe)) { /* ... */ }
```

### Query elements in the page

```javascript
const elements = doc.querySelectorAll('.some-class');
elements.forEach(el => console.log(el.textContent));
```

### Execute scripts in the pane

```javascript
iframe.contentWindow.eval('alert("Hello from BMUX!")');
```

## Common Patterns

### Form field extraction

```javascript
'extract-forms': {
    scope: 'pane',
    description: 'Extract all form fields from the page',
    usage: 'extract-forms',
    execute: function (api, args) {
        const pane = api.pane;
        if (!pane) return 'Error: No pane';

        const doc = safeGetIframeDocument(pane.querySelector('iframe'));
        if (!doc) return 'Error: Cannot access page content';

        const forms = doc.querySelectorAll('form');
        let output = `Found ${forms.length} form(s)\n\n`;

        forms.forEach((form, i) => {
            output += `Form ${i}:\n`;
            form.querySelectorAll('input, textarea, select').forEach((input) => {
                output += `  - ${input.name || input.id}: ${input.type}\n`;
            });
        });

        return output;
    }
}
```

### Data scraping

```javascript
'scrape': {
    scope: 'pane',
    description: 'Scrape text from matching elements',
    usage: 'scrape <selector>',
    execute: function (api, args) {
        const pane = api.pane;
        if (!pane) return 'Error: No pane';
        if (args.length === 0) return 'Error: Provide a CSS selector';

        const doc = safeGetIframeDocument(pane.querySelector('iframe'));
        if (!doc) return 'Error: Cannot access page content';

        const data = Array.from(doc.querySelectorAll(args[0])).map((el) => el.textContent.trim());
        console.log('Scraped data:', data);
        return `Scraped ${data.length} items. Check the console.`;
    }
}
```

### Layout scripting

Overlay commands make multi-pane layouts scriptable, without reloading anything:

```javascript
'study': {
    scope: 'overlay',
    description: 'Wide reading pane plus a stack of notes panes',
    usage: 'study',
    execute: function (api) {
        const client = api.client;
        const panes = client.getPanes();

        if (panes.length < 3) {
            client.splitWindow('horizontal', { size: 0.6 });
            client.splitWindow('vertical', { size: 0.5 });
        }

        client.applyLayout('main-vertical');
        client.renamePane(client.getPanes()[0], 'Reading');
        return 'Study layout ready';
    }
}
```

### Reporting on the layout

```javascript
'sizes': {
    scope: 'overlay',
    description: 'Show every pane size as JSON',
    usage: 'sizes',
    execute: function (api) {
        const client = api.client;
        return JSON.stringify(client.getPanes().map((pane) => ({
            id: client.getPaneId(pane),
            title: client.getPaneTitle(pane),
            size: client.getPaneSizeLabel(pane),
            zoomed: client.isZoomed(pane)
        })), null, 2);
    }
}
```

## Error handling

```javascript
execute: async function (api, args) {
    try {
        return doWork(api, args);
    } catch (e) {
        return `Error: ${e.message}`;
    }
}
```

The dispatcher also catches throws and turns them into `Error: <message>`, so a
bug reports itself in the console instead of breaking the input.

## Async operations

Commands may be `async`; the dispatcher awaits them:

```javascript
execute: async function (api, args) {
    const response = await fetch('https://api.example.com/data');
    return `Fetched ${(await response.json()).length} items`;
}
```

## Logging vs. returning

- **Return**: displayed by the entry point that ran the command (console
  scrollback, or the pane's output area).
- **`api.log(msg)`**: append to the debug console directly.
- **`console.log()`**: browser DevTools only.

## Verifying a change

1. `node --check content/commands.js`
2. Reload the extension in `chrome://extensions`, then refresh the page.
3. Open the overlay and run the command from the debug console (`$`), the `:` line
   and a pane's input (`>`) — all three should behave the same.
4. Run `help`: the new command must appear with its usage line.
5. Check a bad argument: it should return a message, not throw, and it must not
   change the layout or move focus.
6. If the command changes the layout, check that the pages in the panes are still
   alive (their iframes must not be recreated).

## Command template

```javascript
'my-command': {
    scope: 'pane',
    description: 'One-line description of what this does',
    usage: 'my-command <required> [optional]',
    execute: async function (api, args) {
        const pane = api.pane;
        if (!pane) return 'Error: No pane';

        if (args.length === 0) {
            return 'Error: Usage: my-command <required> [optional]';
        }

        const iframe = pane.querySelector('iframe');
        if (!iframe) return 'Error: No iframe found';

        const doc = safeGetIframeDocument(iframe);
        if (!doc) return 'Error: Cross-origin content';

        try {
            const result = doWork(doc, args);
            console.log('[my-command] result:', result);
            return `Success: ${result}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }
}
```

Happy coding! A new command is available from every entry point and listed by
`help` as soon as it is in `BMUX_COMMANDS`.
