# BMUX Version 0.9.0 - Release Summary

## Release Information

**Version**: 0.9.0
**Release Date**: November 10, 2026
**Status**: Menu, toolbar and help release
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Menu | Clicking the icon opens **Toggle** and **Settings** (frost-styled popup); `Alt+Shift+B` still toggles, `Ctrl+Shift+L` opens the menu |
| Toolbar | The overlay's buttons are data — add any command, reorder, delete; verified against the registry before saving |
| Defaults | 16 buttons, including `Panes`, `Windows`, `Cookies`, `Storage`, `Forms`, `Outline` for the inspection commands |
| Storage | `chrome.storage.local → toolbar:buttons`, owned by the background (`toolbar-get`/`set`/`reset`), capped at 24 |
| Help | `help` prints box tables per scope; `help <command>` prints usage, arguments, flags, examples, notes, see-also |
| Search | `help <filter>` matches names and descriptions; aliases resolve to their target |

## The shape of it

**The menu** is two verbs and no state: Toggle asks for the active tab and sends it
`{ command: 'toggle-bmux' }` — the message the icon used to trigger itself — and
Settings calls `chrome.runtime.openOptionsPage()`. Activation therefore still has one
implementation, in the content script.

**The toolbar** is configuration. `background/main.js` stores the list and validates
its *shape* (labels, lengths, dedupe, 24 max). The settings page loads
`content/scripts.js` and `content/commands.js`, so it validates the *command* against
the real registry and shows the usage of whatever you type; the content script's
`sanitizeToolbar()` checks again at render time and skips unknown commands with a log
line, so a stored button can never be dead.

**Help** is data too: `BMUX_HELP` holds `args`, `flags`, `examples`, `notes`,
`related` and `aliasOf` per command, and the renderer turns that into tables. The
harness fails if a visible command has no entry, which is what keeps the detail pages
from going stale.

## Docs

README (menu, toolbar and help sections, new screenshots), QUICKSTART (menu, toolbar,
help), COMMAND_USAGE (the `help` entry with its four modes), ADDING_COMMANDS (the
`BMUX_HELP` entry every new command needs, and toolbar eligibility), IMPLEMENTATION
(section 23: the menu, the configuration and the help data). All stamped 0.9.0.

## Verification

- **1194 jsdom checks** — help (overview, categories, sub-categories, `overlay`/`pane`
  scopes, detail, filter, alias, unknown, metadata coverage), the toolbar version chip
  (present, absent without a manifest, restored), toolbar rendering from defaults and
  from a stored configuration, `sanitizeToolbar` behaviour, and the background
  configuration API.
- **188 Chromium checks** — the version in the toolbar and in the menu, the settings
  page (list, catalog, refusal of an unknown command, acceptance of a real one, save),
  the overlay rendering the saved toolbar after a reload, reset to defaults, and Toggle
  from the menu activating BMUX.

---

# BMUX Version 0.8.0 - Release Summary

## Release Information

**Version**: 0.8.0
**Release Date**: November 10, 2026
**Status**: Inspection release
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Cookies | `list-cookies` / `cookies` (httpOnly included), `set-cookie`, `delete-cookie`, `clear-cookies`; `-j` and a Netscape jar for `curl`/`wget`/`yt-dlp` |
| Storage | `list-storage [local\|session] [pattern] [-j] [--keys]`, `set-storage <key>=<value> [session]` (and `--remove`) |
| DOM inventory | `list-forms` (fields, types, required, passwords masked), `list-scripts` (`[3rd]` flagged), `list-resources`, `outline` (headings + landmarks + level jumps) |
| Text and code | `find-text` (boxes drawn in the pane), `eval` / `js` (page-world, prints tables or pretty JSON) |
| Cross-origin | A frame-side relay (`content/inspect.js`) answers inside the pane, so inspection works on panes BMUX cannot otherwise read |
| Permissions | `cookies` added to the manifest; used only when you ask about a pane's jar |
| Commands | 52 → 70 (12 new commands, 6 aliases) |
| Palettes | Seven: `frost` (default), `classic`, `midnight`, `amber`, `light`, `nord`, `rose` — one CSS-variable block each, `theme next` to cycle |
| Output | Box-drawn tables with right-aligned numbers and ellipsised cells; `-j` for JSON |
| Pointer focus | Clicking a pane's *page* (not just its footer) focuses it: frames report pointer activity to their parent |
| README | Centred logo (light and dark variants) above a centred badge row |

## The shape of it

**The relay.** `content/inspect.js` is injected into every frame by the manifest. The
top frame posts `{ __bmuxInspect: <nonce>, kind, args }` into the pane's
`contentWindow` (allowed across origins) and waits for
`{ __bmuxInspectReply: <nonce>, ok, result }` from that same window, with a 1.5 s
timeout that reports "the pane did not answer". Handlers are synchronous DOM reads
except `frame-id`, which is a promise.

**`eval` is the exception.** MV3 forbids `eval` inside a content script — the first
implementation hit exactly that wall, and an inline `<script>` injected from the
isolated world was refused as well. So the pane reports its own `frameId`, and the
background runs the expression with `chrome.scripting.executeScript({ world: 'MAIN' })`
in that frame: real page globals, values serialised in-page (nodes as `<h1#id>`,
depth 3, arrays capped at 50) and formatted by the top frame.

**Cookies are brokered by the background** through the `cookies` permission, which is
the only way to see `httpOnly` cookies or to touch a cross-origin pane's jar. The
commands pass the pane's URL, so the jar is the right origin's, and nothing is stored
by BMUX.

## What is still same-origin only

`source`, `filter` and `capture-pane` read the pane's document from the top frame, so
they still need a same-origin pane. Everything inspection-related does not — that is
the point of asking the frame itself.

## Docs

README (inspection section, command tables, permissions), QUICKSTART (inspection
block), COMMAND_USAGE (twelve command entries plus a new section 13 on the relay and
the cookie broker), ADDING_COMMANDS (how to write a pane-inspecting command),
IMPLEMENTATION (section 21, the mechanisms and their limits), CROSS_ORIGIN (corrected:
cross-origin panes are no longer opaque). All stamped 0.8.0.

## Second pass (same release)

- **Seven palettes**, frost still the default; `theme` lists them, `theme next`/`prev`
  cycle, the choice is saved with the layout. `setTheme()` falls back to frost for an
  unknown name, so a corrupt stored value cannot leave the UI unstyled.
- **Box-drawn tables** in every listing command, with numeric alignment, ellipsis and
  a 96-character wrap; `list-panes` gained a `state` column (`ACTIVE+ZOOM`).
- **Pointer focus fixed**: a click inside a pane's iframe now makes that pane active —
  the frame reports `pointerdown`/`focus` to its parent, which maps the window back to
  its pane. Previously only the footer worked, because switching between two iframes
  never blurs the top window.
- The README opens with the logo (a light and a dark rendering of the same artwork,
  chosen with `prefers-color-scheme`) above a centred badge row.

## Verification

- **1138 jsdom checks** (108 new in total): every frame handler, the message protocol (including
  the async `frame-id` path and a foreign source being ignored), the top-frame relay
  (timeout, source matching, formatting), the cookie broker (list/filter/set/remove/
  clear, Netscape export, missing permission) and the `eval` plumbing.
- **173 Chromium checks** (26 new in total), including real mouse clicks on a pane's
  page focusing that pane and the computed colours changing with `theme midnight` /
  `light` / `frost`, plus: storage, forms, outline, find-text boxes inside
  the pane, `eval`, scripts and resources on the test page; the same inspection on a
  cross-origin pane (`localhost` vs `127.0.0.1`); cookies set, listed, exported and
  deleted through the browser's own API.

---

# BMUX Version 0.7.0 - Release Summary

## Release Information

**Version**: 0.7.0
**Release Date**: November 9, 2026
**Status**: Windows release
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Windows | Up to six named layouts in one tab, each with its own tree, ratios, focus, zoom and pane consoles |
| No reloads | Switching a window is a `display:none` swap — proven in Chromium with a page-load counter that does not move |
| Commands | `new-window [name]`, `next-window`, `previous-window`, `last-window`, `select-window`, `rename-window`, `kill-window`, `list-windows`, and `reset-layout` for the old reset |
| Keys | `n` `p` `c` `&` `,` `w` — in Control Mode and after `Ctrl+b` |
| Mouse | A status-bar window chip (`2:docs (2/2)`) that switches on click |
| Persistence | Snapshot v2 stores every window plus `activeWindow`; version-1 snapshots are upgraded on read into one window named `main` |
| Caps | 6 windows, 12 panes per window, 24 panes total, depth 32, 96 KB, window names sanitized |
| Breaking | `new-window` now creates a window; the reset it used to do is `reset-layout` |

## The shape of it

The client's live fields (`layout`, `zoomedPane`, `rootPane`, `layoutName`,
`lastActivePane`) always describe the **active** window; inactive windows keep their
own copy in a record. Switching is `stashActiveWindow()` → load the target record →
`applyWindowVisibility()`, after which the existing renderer runs unchanged on one
tree. Panes are never moved between windows in the DOM: a hidden window is
`display:none`, so its iframes keep running and a switch costs nothing. That is the
trade behind the six-window cap.

The background owns the migration: `normalizeSnapshot()` accepts version 1 or 2,
wraps a v1 tree as one window, enforces the caps and returns the v2 form to store —
so the content script only ever applies one format.

## What does not come back

Restoring still **recreates** panes (pages load fresh); prompts, filter boxes and
scrollback remain transient. A hidden window's pages keep their state while the
window is hidden, but a reload recreates them like everything else.

## Docs

README (feature section, command and key tables, roadmap, limitations),
QUICKSTART (windows block), COMMAND_USAGE (nine command entries, key rows, status
bar, snapshot v2 and the upgrade), ADDING_COMMANDS (window-aware command rules and
the v2 snapshot shape), IMPLEMENTATION (the window model, migration, caps), SCRIPTS
(windows in the walkthrough, `reset-layout`) — every document stamped 0.7.0. Both
shipped `.bmux` demos gained a windows chapter (87 and 80 commands) and still run
clean on dtrh.net.

## Verification

- **959 jsdom checks** (57 new): creation, switching, wrapping, rename via prompt,
  kill with cleanup and the last-window refusal, per-window isolation of
  tree/focus/zoom, per-window numbering with tab-wide unique ids, `list-windows`
  text and JSON, `reset-layout` scoping, both-window persistence, the **v1 upgrade
  path**, the window/pane caps, two-window inheritance, follow-the-page limited to
  the active window, and a script driving windows.
- **147 Chromium checks** (14 new): a second window built and switched with the
  page-load counter unchanged, the chip click, a reload restoring both windows with
  the active one visible, and `kill-window` through its confirmation card.
- The demos were re-checked in Chromium on dtrh.net with the new windows chapter.

---

# BMUX Version 0.6.0 - Release Summary

## Release Information

**Version**: 0.6.0
**Release Date**: November 9, 2026
**Status**: Scripting release
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Script files | `.bmux`: one command per line, `#` comments, `sleep` to pace it — run with `script run`, `script file`, or `script demo` |
| Pacing | `sleep <seconds>` (`2`, `0.5`, `2s`, `250ms`), awaitable and cancellable: Stop never waits out a pause |
| The panel | Run / Stop / File / ×, `Ctrl+Enter`, and a progress line naming the command in flight (`7/73 · select-layout main-vertical`) |
| A run is a transcript | Every line echoed as `[7/73] …` with its result; a failing line does not stop the rest; the summary counts the errors |
| One runner | Second runs refused, nested runs refused, so `script stop` always means something |
| Shipped examples | `examples/demo.bmux` (site-agnostic; what `script demo` runs) and `examples/dtrh-tour.bmux` (the dtrh.net tour used for the screenshot and the recording) |
| Not code | No variables, loops or branches by design: every line is something you could have typed |

## The shape of it

`content/scripts.js` holds the format — `bmuxParseScript()` (comments, blank lines,
pasted `>` prompts, per-line limits), `bmuxParseSleepArg()`, and the built-in demo
text. `BMUXClient.runScript()` walks the parsed lines through `runCommand()`, the
same dispatcher the console uses, awaiting each one; `sleep` is a command whose
promise lives in `client.sleepState`, so `script stop` resolves it early and the
loop breaks before the next line. The panel is part of the injected overlay; the
File button uses a real `<input type=file accept=".bmux">`, so nothing is read from
disk without the user picking it.

## What a script cannot do

It cannot click (prompts wait for a human, or 15 s), survive a reload or a new tab
(the runner dies with the page, so the persistence round trip stays manual), read
files or the network, loop or branch, or run in the background. All four are
documented rather than worked around — a script stays a list of commands.

## Docs

New **[docs/SCRIPTS.md](docs/SCRIPTS.md)**: the format, the `sleep` reference, the
limits, what a script cannot do, how to write a demo (with the pacing table taken
from the shipped script), and how to record one. README, QUICKSTART, COMMAND_USAGE
(new section 12), ADDING_COMMANDS (script-friendly commands) and IMPLEMENTATION
(section 20, the engine) all cover the feature, and the README gained a fifth
screenshot of the tour on dtrh.net.

Every current document carries a **0.6.0** stamp, and the sweep fixed what had
drifted: the popup/"New Session" description, `[CONTROL MODE]`/blue-border wording,
a 70% console clamp, `Esc` described as `control-mode off` instead of `escape`,
missing alias keys, and a Firefox claim that no test backed (now stated as
untested). DESIGN and UPDATE_STATUS are labelled historical and point at the
current docs.

## Verification

- **859 jsdom checks** — 48 new: the format (comments, pasted prompts, `sleep`
  forms, limits, per-line errors), the runner (ordering, real pacing, stopping
  mid-sleep, nested-run refusal, panel state, summary wording), the two commands,
  and both examples (they parse, every command they use exists,
  `examples/demo.bmux` is byte-identical to what `script demo` runs, and the site
  tour loads real pages and names its panes).
- **133 Chromium checks** — a `.bmux` uploaded through the real file input and run
  from the panel (`finished · 6/6`, panes and titles changed), then a `sleep 30`
  script stopped from the button, with the following command proven not to run.
- **The demos themselves**, end to end in Chromium on dtrh.net: `script demo`
  finished `73/73` with zero error lines, and `examples/dtrh-tour.bmux` finished
  `63/63` with the panes it built (home, `/changelog`, `/tools`) — a 45-second
  recording of the tour was captured frame by frame while it ran.

---

# BMUX Version 0.5.0 - Release Summary

## Release Information

**Version**: 0.5.0
**Release Date**: November 9, 2026
**Status**: Layout persistence release
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Reload survival | Splits, ratios, pane URLs, titles, focus, maximize and console state are saved per tab and restored on load |
| Storage | `storage.session` per tab (reload-safe, dies with the browser) + `storage.local` for explicit named layouts; never `sync` |
| Commands | `persist [on\|off\|status]`, `inherit [on\|off\|status]`, `save-layout`, `restore-layout`, `list-layouts`, `delete-layout` |
| Follow the page | A layout belongs to the tab, so navigating elsewhere repoints the root pane at the new page and leaves the other panes intact instead of dragging the old site back |
| Inheritance | A new tab with nothing saved adopts the newest layout from another tab — same splits, its own page in the root pane (`inherit off` to stop it) |
| Safety | Snapshots validated whole (version, shape, ratios, ≤ 12 panes, ≤ 32 deep, ≤ 64 KB); bad ones ignored, never half-applied |
| Housekeeping | Tab-close cleanup, startup pruning, 6 h fallback where `storage.session` is missing |
| Cleanup | The dead session `STATE` machinery and the "State Fetched" stub are gone; `unlimitedStorage` dropped |
| Line editing | `Up`/`Down` history and `Tab` completion in the pane console, the floating console and the `:` line — one shared history, command-aware arguments |
| Activation | The toolbar icon (or `Alt+Shift+B`) turns BMUX straight on — overlay plus Control Mode — and off again; the popup is gone |
| Key resilience | `%`/`Shift+5`/`5` and `"`/`Shift+'`/`'` all split; `Ctrl+b` works inside Control Mode; `keys` prints what the keyboard actually sent |
| Console size | The pane console drags to 90% of the pane from a visible grip (with a drag shield); the floating console gained a bottom grip |
| Palette | Frost theme by default (cold blues, ice text, ice-cyan accents as CSS variables); Control Mode is a quiet inset ring, not a 5px frame; `theme classic` restores black/green |
| Debug output | The debug window is optional and hidden by default; `verbose` mirrors its output into the focused pane; `info` prints layout/panes/keys/state |
| Detachable console | `log detach` / `log attach` / the `⧉` footer button float a pane's console in its own draggable window, scrollback intact, restored with the layout |

## The shape of it

The content script never touches storage. It asks the background, which knows the
tab id and owns the keys:

```
               persist-save {snapshot}                     storage.session
content ─────────────────────────────► background ─────────────────────► layout:tab:<tabId>
        ◄─────────────────────────────            │
               persist-load {enabled, snapshot}     └───► storage.local
                                                          layout:named:<origin>:<name>
                                                          persist:enabled
```

**Writes** are debounced from every structural change (400 ms) plus an immediate
save when the tab is hidden or unloaded. **Reads** happen before the first pane is
drawn, so a restore never flashes an empty overlay, with an 800 ms ceiling if the
service worker is cold.

## Following the page, and new tabs

Because a snapshot is stored against the **tab id**, it outlives the address it was
built on. When the page underneath changes, `applySnapshot` sees a stored `url` that
no longer matches `window.location.href` and repoints the **root pane** at the
current page; every other pane keeps its URL, and a plain reload restores the
layout exactly as saved.

A tab with no snapshot of its own asks the background for the **newest** one saved
by another tab and adopts its shape — splits, ratios, titles, console state — with
its own page in the root pane. That is on by default; `inherit off` restores the
older behaviour of a single fresh pane, and the switch also stops a tab offering
its layout to others.

## What does not come back

Restoring **recreates** the panes, so the pages load fresh: scroll position, form
input and in-page JavaScript state cannot be carried across a reload. Prompts,
filter boxes, focus history and console scrollback are not persisted either (the
console's open state and height are).

## Docs

README leads with four real screenshots captured against
[dtrh.net](https://www.dtrh.net/) with the unpacked extension: activation and a
three-pane frost layout, `filter links` with boxes, a hovered match and the refine
card, a detached console, and the classic palette for comparison
(`docs/images/`). All 42 commands are documented in both the README tables and the
command guide.

## Verification

- 811 jsdom checks — with the real `background/main.js` running as a second window
  against in-memory `storage.session` / `storage.local`, so the shipped persistence
  path is exercised end to end: round trip, reload via a fresh content script,
  named layouts, the off switch, corrupt/junk/unsupported/malformed snapshots,
  caps, tab-close cleanup, startup pruning, exit saves, debounce coalescing, plus
  the navigation rule (stale root URL repointed, other panes untouched) and
  new-tab inheritance.
- 121 Chromium checks — including a real `page.reload()` restoring a 30/70 split
  with a custom title and the maximize state, pages loading fresh afterwards,
  `save-layout` → `new-window` → `restore-layout`, `persist off` → reload → one
  pane, a real navigation that keeps the other panes in place, and a second tab
  inheriting the layout with its own page in the root pane.
- Not verified: an actual browser restart (the harness cannot restart Chromium),
  the `storage.session` fallback path on a browser that lacks it, and touch input.

---

# BMUX Version 0.4.0 - Release Summary

## Release Information

**Version**: 0.4.0
**Release Date**: November 9, 2026
**Status**: Chaining, clickable prompts, and filter refinement
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Chaining | `;` runs commands in sequence from every entry point, awaited, errors do not stop the chain |
| Prompts | `api.ask` / `api.askText` render a clickable card (buttons, digits, `Enter`, `y`/`n`, `Esc`, `yes`/`no`) |
| Maximize | Every pane footer has a `⤢` / `⤡` button, the on-screen form of `Ctrl+b`, `Shift+z` |
| Filter refinement | Draw and label first, then *Inside a container*, *Exclude*, *Text contains*, *Visible only*, *Unique targets*, *Keep these*, *Cancel* |
| Filter accumulation | `filter img; filter a` boxes both (`--replace` for a clean set) |

## The workflow this enables

```
> filter links
23 match(es) boxed and labelled
[ Yes, refine ]  [ No, keep these ]
> (click Yes)
Narrow them down how?   [ Inside a container ] [ Text contains ] [ Visible only ] [ Unique targets ] [ Keep these ] [ Cancel ]
> (click Inside a container) → type "main" → Enter
7 match(es) boxed   →  [ Yes, refine ]  [ No, keep these ]
> (click Keep these)
```

Every step is a real button, and every step also exists as a flag
(`--in main --text price --visible --unique href`), so the interactive path and
the scriptable path are the same implementation.

## Notes and limits

- Refinement narrows the drawn set; a page mutation re-queries the selectors, so
  boxes can re-broaden after refining (documented).
- "Visible only" means rendered, not "in the viewport".
- Chained filters append until `filter -c` or `--replace`.
- `&&` (stop on error) is not implemented; a chain always runs every segment.
- Cross-origin panes cannot be boxed.

## Verification

- 559 jsdom checks and 78 checks in Chromium 150 with the extension unpacked,
  including the tokenizer (quotes/brackets/`\;`), chain order and continuation,
  clicking through Yes → Unique → No and Yes → Text → typed word → Keep these,
  `filter -y img; filter -y a` boxing three elements, and the per-pane maximize
  button flipping glyphs and restoring.
- Not verified: touch input, cross-origin panes, the 15s prompt timeout in a real
  browser, and refresh-after-refinement outside jsdom.

## Breaking changes

None. The filter question now comes *after* drawing instead of before, and
`yes`/`no` answer whatever prompt is open.

---

# BMUX Version 0.3.0 - Release Summary

## Release Information

**Version**: 0.3.0
**Release Date**: November 9, 2026
**Status**: Console and filter-usability release
**License**: MIT

---

## Highlights

| Area | What shipped |
|------|--------------|
| Pane console | Persistent scrollback with a scrollbar, toggle button, drag-to-resize, `log` command and `l` key; no more five-second auto-collapse |
| Debug console | Resizable from its bottom-right corner, still draggable |
| Filter presets | `filter links internal`, `images large`, `tables rows`, `media video`, `prices`, `comments`, … plus `filter --presets` |
| Confirmation | Presets and result sets over 25 ask first: `yes` / `no` (or `y` / `n` / `Esc`), with `filter -y` to skip |
| Zoom | `Shift+z` toggles zoom, the tmux `prefix + Z` binding |

## Why these three

1. **The pane console was write-once.** It showed one result, hid itself after
   five seconds and could not be reopened. It is now a scrollback that stays open,
   scrolls, toggles from the footer, and resizes by dragging its top edge — the
   height and open state per pane.
2. **`filter` needed vocabulary.** `filter links internal` now works because a
   preset can carry a predicate (`href` resolved against the pane's origin, with
   a base-URI fallback), which no selector can express alone. Presets and big
   results ask for a yes/no answer before drawing, so a stray `filter div` no
   longer paints a thousand boxes.
3. **tmux muscle memory.** `Ctrl+b` then `Shift+z` maximizes the focused pane and
   the same chord restores the layout, exactly like tmux (Control Mode `Shift+z`
   too; `z` still works).

## Verification

- 558 jsdom checks and 65 checks in Chromium 150 with the extension loaded
  unpacked, including: the console opening on a command and still being open after
  5.3s, a real grip drag making it taller, `log off`/`log on` preserving the
  scrollback, a preset asking before drawing with `yes` boxing it, `filter -y
  links internal` boxing only the on-site link, and `Shift+z` maximizing and
  restoring the pane.
- Not verified: touch input, cross-origin panes, and the 15-second prompt timeout
  in a real browser.

## Breaking changes

None. `clear` now empties the pane console scrollback rather than the old output
line, and `filter` asks before large queries; both are documented.

---

# BMUX Version 0.2.0 - Release Summary

## Release Information

**Version**: 0.2.0
**Release Date**: November 9, 2026
**Status**: Visual filter release
**License**: MIT

---

## Highlights

**`filter` now shows you what it found.** Every match gets a box inside the pane,
a numbered tab, and a name in the pane's status line while you hover it.

| Area | What shipped |
|------|--------------|
| Highlighting | `filter <selector>` boxes every match: outline, wash, corner ticks, index tab |
| Naming | Hover a match -> `FILTER: .card - DIV#alpha.card "Product card" · 1/2` in the pane footer, box turns green |
| Live | Debounced MutationObserver re-queries and redraws when the page changes |
| Limits | `filter -n <max>` (default 200, ceiling 1000), `filter -l` lists only |
| Clearing | `Esc` (top frame, inputs, or with focus inside the pane) and `filter -c` |
| Keys | New `escape` command, so keys relayed from a pane frame behave the same |

## How it is drawn

The boxes are sibling overlays appended to the pane document by the top frame:
one `[data-bmux-filter-layer]` with a `[data-bmux-filter]` per match, positioned in
document coordinates, `pointer-events: none`, styled by an injected `<style>`.
Nothing is wrapped, moved or restyled on the page itself, so the page's layout is
untouched; boxes scroll with the content and are removed as a unit.

Same-origin only: a cross-origin pane cannot be measured or written into, and
`filter` says so instead of pretending.

## Verification

- 481 jsdom checks and 49 checks in Chromium 150 with the extension loaded
  unpacked, including a real `filter .box` on a live page, real hover naming
  (`· 1/2` then `· 2/2`), Escape from console focus and from inside the pane, and
  `filter -c`.
- Not verified: cross-origin panes, touch input, and the MutationObserver refresh
  in a real browser (jsdom only).

## Breaking changes

None. `filter` without a selector is now a usage error, and its output wording
changed; the command still exists with the same name and scope.

---

# BMUX Version 0.1.0 - Release Summary

## Release Information

**Version**: 0.1.0
**Release Date**: November 9, 2026
**Status**: Layout engine and pane management release
**License**: MIT

---

## Highlights

**Percentage splits, mouse resizing, zoom, layouts and real pane management** -
on top of a layout engine that never reparents a pane.

| Area | What shipped |
|------|--------------|
| Layout engine | Binary split tree with ratios; absolutely positioned panes; fractional rectangles |
| Splitting | `split-window -h/-v` with `-l <size>`, `-p <size>`, `-b` (new pane first), `-d` (keep focus) |
| Resizing | Mouse-draggable boundaries with double-click reset; `resize-pane -L/-R/-U/-D`, `-x <size>` |
| Zoom | `resize-pane -Z`; other panes keep running while hidden |
| Layouts | `even-horizontal`, `even-vertical`, `main-vertical`, `main-horizontal`, `tiled`, `next-layout` |
| Pane management | Real `kill-pane` (last pane refused), `swap-pane`, `rotate-window`, `display-panes` |
| Pane identity | Ids `%N` (fixed), layout-order numbers, `[number id]` badges, titles, `list-panes -j` |
| Focus | Toolbar buttons, arrows with wrap-around, click-to-focus (including inside iframes), `cycle-pane`, `last-pane` |
| Commands | 25 commands in one registry (`content/commands.js`) shared by toolbar, console, `:` line, pane inputs, keys and the relay |
| Inspection | `source`, `filter`, `capture-pane`, `url`, `reload` per pane |

## The important one: pages are never reloaded by layout changes

Until 0.0.1, splitting reparented the pane's iframe into a new flex container -
and moving an iframe in the DOM reloads it, so splitting reloaded the page you
were looking at. In 0.1.0 the layout is data:

```
split(row, 0.3) --> leaf(%1)         30% wide
                \-> split(column) --> leaf(%2) 55% of the remainder
                                   \-> leaf(%3) 45% of the remainder
```

Panes are absolutely positioned children of `#bmux-panes` and are never moved.
Splitting, applying a layout preset, swapping, rotating or zooming therefore keeps
every page alive - which is verified in the test harness by a marker set on the
pane iframe's `window` that survives all of those operations.

## Verification

- `node --check` on every changed script; all files kept CRLF line endings.
- 439 jsdom checks (dispatcher, key tables, layout maths, mouse drag, layouts,
  kill/resize/zoom, bad input, relay, and the no-reload guarantee).
- 36 checks with the extension loaded unpacked in Chromium 150 (headless):
  real mouse drag on a split handle, `z` zoom, `Space` layout cycling,
  `main-vertical`, `swap-pane`, `Alt+Arrow` resizing, `rename-pane`,
  `capture-pane`, killing panes down to the last one, arrow focus, and no
  console/page errors.
- Not covered: the `Alt+Shift+B` global hotkey (not synthesizable from DevTools),
  the popup buttons, `Ctrl+b` in a real browser, `chrome.storage`, and
  cross-origin panes.

## Breaking changes

None: every 0.0.1 command still exists with the same meaning, and the extension
still loads as an unpacked MV3 extension with the same permissions.

## Known gaps

Floating panes, `break-pane`/`join-pane`, multiple windows, session persistence
and input broadcasting are not implemented yet; see CHANGELOG.md for the roadmap.

---

# BMUX Version 0.0.1 - Release Summary

## 📦 Release Information

**Version**: 0.0.1  
**Release Date**: December 9, 2025  
**Status**: Initial Public Release  
**License**: MIT

---

## 📂 Project Organization

### Root Files
```
BMUX/
├── README.md              # Main documentation (comprehensive)
├── QUICKSTART.md          # Quick reference card
├── CHANGELOG.md           # Version history
├── LICENSE                # MIT License
├── .gitignore            # Git ignore rules
├── manifest.json          # Extension config (v0.0.1)
└── rules.json             # CSP removal rules
```

### Core Directories
```
├── background/            # Service worker
│   └── main.js           # State management
├── content/              # Content scripts
│   ├── main.js          # UI and controls
│   ├── commands.js      # Command registry
│   └── styles.css       # Modern UI styles
├── popup/                # Extension popup
│   ├── index.html       # Popup UI
│   └── script.js        # Popup logic
└── docs/                 # Documentation
    ├── ADDING_COMMANDS.md
    ├── COMMAND_USAGE.md
    ├── CROSS_ORIGIN.md
    ├── CSP_HANDLING.md
    ├── DESIGN.md
    ├── IMPLEMENTATION.md
    └── UPDATE_STATUS.md
```

---

## ✨ Feature Checklist

### Core Functionality
- [x] Horizontal pane splitting (`%`)
- [x] Vertical pane splitting (`"`)
- [x] Unlimited nested splits
- [x] Current URL cloning on split
- [x] Active pane tracking (blue border)

### Control Systems
- [x] Control Mode (Alt+Shift+B)
- [x] Legacy prefix mode (Ctrl+b)
- [x] Visual mode indicators
- [x] Keyboard shortcut registration
- [x] Input field exclusion (debug console, pane inputs)

### Command System
- [x] Per-pane command input (green `>`)
- [x] Global debug console (green `$`)
- [x] Extensible command registry
- [x] Built-in commands (7 total)
- [x] Console view transformation (`source`)
- [x] Browser view restoration (`restore`)

### Browser Compatibility
- [x] CSP header removal (GitHub, Google, etc.)
- [x] Cross-origin safety checks
- [x] Graceful error messages
- [x] Fallback strategies

### UI/UX
- [x] Modern glassmorphism design
- [x] Draggable debug console
- [x] Per-pane footers
- [x] Visual feedback (borders, colors)
- [x] Responsive layouts

### Documentation
- [x] Comprehensive README
- [x] Quick reference guide
- [x] Developer documentation (7 guides)
- [x] Command creation tutorial
- [x] Security documentation
- [x] Changelog

---

## 📊 Statistics

### Code
- **JavaScript Files**: 4 (main.js x2, commands.js, script.js)
- **CSS Files**: 1 (styles.css)
- **HTML Files**: 1 (popup/index.html)
- **JSON Files**: 2 (manifest.json, rules.json)

### Documentation  
- **Root Docs**: 4 (README, QUICKSTART, CHANGELOG, LICENSE)
- **Guide Docs**: 7 (in docs/ folder)
- **Total Lines**: ~1500+ lines of documentation

### Features
- **Commands**: 7 built-in
- **Keyboard Shortcuts**: 8 registered
- **Control Modes**: 2 (Control + Legacy)
- **Permissions**: 6 requested

---

## 🎯 Version 0.0.1 Goals - COMPLETE

All planned features for initial release have been implemented:

✅ **Multiplexing Core**
- Window splitting (horizontal/vertical)
- Nested pane support
- URL cloning

✅ **Control Systems**  
- Dual input modes
- Keyboard shortcuts
- Visual feedback

✅ **Command Framework**
- Extensible architecture
- Per-pane + global consoles
- Console view mode

✅ **CSP Handling**
- Header removal
- Cross-origin safety
- Clear error messages

✅ **Documentation**
- User guides
- Developer guides
- Quick reference

✅ **Project Organization**
- Clean file structure
- docs/ folder
- Version tracking

---

## 🚀 Installation Instructions

### For Users
1. Download/clone BMUX folder
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select BMUX folder
6. Refresh any open tabs

### For Developers
1. Clone repository
2. Read `docs/ADDING_COMMANDS.md`
3. Edit `content/commands.js`
4. Reload extension in Chrome
5. Test your changes

---

## 📝 Known Issues (Documented)

### Not Yet Implemented
- State persistence (panes don't survive page reload)
- Pane resizing with mouse
- Arrow key navigation
- Session management

### Browser Limitations
- Some sites use JavaScript iframe busters (unfixable)
- Cross-origin content inspection limited by browser
- Cookie restrictions in third-party contexts

All limitations are documented in:
- README.md (Known Limitations section)
- CHANGELOG.md
- docs/CROSS_ORIGIN.md

---

## 🎉 Achievements

### What Makes BMUX Unique
1. **First TMUX-inspired browser extension** with full pane management
2. **Dual command systems** (modal + prefix) for flexibility
3. **Per-pane consoles** like real TMUX
4. **Console view transformation** for source inspection
5. **CSP bypass** allowing any site in panes
6. **Modern UI** with glassmorphism (not retro terminal)

### Code Quality
- Modular architecture
- Extensible command system
- Cross-origin safety
- Comprehensive error handling
- Well-documented

### Documentation Quality
- 11 total documentation files
- Clear examples
- Security transparency
- Developer tutorials
- User guides

---

## 📈 Next Steps (Version 0.1.0)

### Planned Features
- [ ] State persistence
- [ ] Pane resizing
- [ ] Arrow key navigation  
- [ ] Named sessions
- [ ] Better error handling

### Future Roadmap
- [ ] Firefox compatibility
- [ ] Custom themes
- [ ] Plugin system
- [ ] Cloud sync (optional)

See CHANGELOG.md for full roadmap.

---

## 🎓 Learning Outcomes

This project demonstrates:
- Chrome Extension API mastery
- Manifest V3 implementation
- declarativeNetRequest usage
- Content script architecture
- Cross-origin handling
- UI/UX design
- Documentation best practices

---

## 🙌 Version 0.0.1 Status: **COMPLETE**

All goals achieved. Ready for public release.

**Next**: Tag release, test thoroughly, gather user feedback for 0.1.0.

---

*Generated: December 9, 2025*  
*BMUX Version 0.0.1*  
*"Bringing TMUX to the Browser"*
