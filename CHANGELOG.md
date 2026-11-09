# Changelog

All notable changes to BMUX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-11-09

The layout survives a reload, and named layouts can be saved and restored.
Persistence finally exists, is validated, and can be switched off.

### Added

- **Per-tab layout restore.** The layout of the current tab is saved as it changes
  and restored on the next load: the split tree with its ratios, each pane's URL,
  custom titles, which pane was focused, which was maximized, and each pane
  console's open state and height.
  - stored in `chrome.storage.session` under `layout:tab:<tabId>`, so it survives
    a reload or navigation and dies with the browser;
  - saved on a 400 ms debounce from every structural change, plus immediately when
    the tab is hidden or unloaded;
  - restored **before the first pane is drawn**, so the overlay never flashes an
    empty layout, with an 800 ms ceiling if the service worker is asleep;
  - pane ids and the id counter are restored, so old and new panes never collide.
- **Named layouts** in `chrome.storage.local`, per site origin, explicitly saved:
  - `save-layout [name]`, `restore-layout <name>`, `list-layouts`,
    `delete-layout <name|--all>`;
  - they survive browser restarts, and at most 30 are kept per origin (oldest
    dropped first).
- **A calmer frost palette.** Every terminal surface (pane console, floating
  console, debug window, prompt cards, toolbar, status bar) now uses cold blues and
  ice text with one ice-cyan accent, defined as CSS variables at the top of
  `content/styles.css`. Control Mode is no longer a five-pixel frame around the
  page: it is a one-pixel inset ring plus a tinted `CONTROL MODE` chip in the
  status bar. `theme classic` restores the old black/green terminal look and
  `theme frost` brings the palette back; the choice is saved with the layout.
- **The debug window is optional.** It starts **hidden**; `debug on|off|toggle`
  (and the preference, saved per tab) shows it. With it hidden, `verbose on`
  mirrors debug output into the focused pane's console instead, so nothing is
  invisible.
- **`info [all|layout|panes|keys|state]`** prints verbose diagnostics — the layout
  tree, every pane with its size/console/zoom state, the recent key log, and the
  runtime state (theme, verbose, debug window, auto-restore, filters, prompts,
  history). This is the command-line answer to "where do I see what BMUX is
  doing", now that the debug window is not always on screen.
- **Detachable pane console.** Any pane's console can be pulled out into its own
  window and put back:
  - `log detach` / `log attach`, or the `⧉` button in the pane footer;
  - the window moves by dragging its header and resizes from its corner or bottom
    edge (same drag shield as everything else), and its `⧉ dock` button puts it
    back in the pane;
  - the *same* panel is moved, so the scrollback, history and input listeners
    survive the trip;
  - the detached state and window rectangle are saved with the layout, so a reload
    brings the floating console back.
- **Activation is one state.** Clicking the extension icon (or pressing
  `Alt+Shift+B`) now turns BMUX *on*: the overlay appears with Control Mode
  already active, so the blue border and the keys are live immediately. Pressing
  it again hides the overlay and leaves Control Mode. The popup is gone — the icon
  is the button — and `detach` (`d`) toggles the same state.
- **Keyboard shortcuts that survive layout differences.** `event.key` is not the
  same on every keyboard: with Shift held, some report `%` and others report `5`
  (likewise `''` / `"`). Key lookup now tries the character, the `Shift+<code>`
  form, the bare `code`, and the lowercase character, and both key tables carry
  `Shift+Digit5` / `Digit5` / `5` and `Shift+Quote` / `Quote` / `'` aliases. `%`,
  `Shift+5`, `5`, `"` and `'` all split.
- **`Ctrl+b` works in every mode**, including inside Control Mode (tmux behaviour)
  — the prefix is checked before the Control Mode branch, so mixing the two can no
  longer swallow the second key.
- **`keys` command**, plus a log line for any key that resolves to nothing:
  `Unbound key: … (code …) with Shift`. `keys` prints the last dozen events with
  their raw `key`, `code`, modifiers, the mode they were read in, and the command
  they resolved to — so a shortcut that does not fire can be diagnosed instead of
  guessed at.
- **The pane console resizes like a pane**: a visible two-line grip on its top edge
  (12 px grab area, double-click resets), draggable to 90% of the pane, with a drag
  shield so the pointer cannot slip onto the iframe mid-drag. The floating console
  gained a bottom edge grip next to its corner grip.
- **Command line editing in every input.** The pane console, the floating debug
  console and the `:` line now share one history and one completion engine:
  - `Up` / `Down` recall the previous commands (`Down` past the newest restores
    whatever you were typing); consecutive duplicates collapse, and the last 200
    commands are kept;
  - `Tab` completes the command name, then that command's arguments — layout
    names, resize flags, `log` actions, focus directions, pane ids and numbers,
    filter presets and their variants, and so on;
  - an unambiguous `Tab` completes and adds a space, an ambiguous one fills in the
    common prefix, and pressing `Tab` again lists the candidates in the console;
  - completion works on the segment under the caret, so `list-panes; list-p<Tab>`
    completes the second command;
  - history is shared between all three inputs, so a command typed in a pane can
    be recalled in the floating console.

- **`persist [on|off|status]`** — the auto-restore switch. `off` clears this tab's
  snapshot and stops all writes; named layouts are untouched because they were
  explicit saves. `status` also says where the current layout came from
  (`fresh`, `session` or `named`).
- **Validation** in the background: snapshots are checked whole before being
  stored or applied — version, tree shape, split ratios in range, URL strings, at
  most 12 panes, depth ≤ 32, ≤ 64 KB. A rejected snapshot is dropped, never
  partly applied.
- **Housekeeping**: closing a tab deletes its snapshot, and on browser startup any
  session layout whose tab no longer exists is pruned.

### Changed

- **The background service worker is now a real component**: it relays command
  lines (unchanged), owns all persistence, and knows which tab is asking. The dead
  `STATE` / `loadState` / `saveState` / `createSession` / `get-state` /
  `new-session` machinery — which was written once on install and read by nobody —
  is gone.
- The popup is removed: `action` no longer declares `default_popup`, so clicking the
  icon runs `action.onClicked` and activates BMUX. `popup/` is deleted; the icon
  and the hotkey are the two ways in.
- `unlimitedStorage` was dropped from the manifest: snapshots are a few KB, so the
  default quota is ample. Fewer permissions, same behaviour.
- Content scripts never touch `chrome.storage` directly: `chrome.storage.session`
  is not readable from them without `setAccessLevel`, and the background already
  knows the tab id.
- `fetchState` / `updateUI` — the code that logged "State Fetched" and did nothing
  — are gone.

### Fixed

- A keydown aimed at a text field was swallowed when that field was not the
  document's `activeElement` (a hidden debug window, a synthetic event): the
  Control Mode handler now also looks at the event target, so typing in any BMUX
  input is never intercepted.
- A pane console given a height taller than its pane could not actually grow that
  far: the iframe flex item refused to shrink (`min-height: auto`), so the panel was
  squeezed back. The iframe now has `min-height: 0` and the panel `flex: 0 0 auto`.
- Dragging a console's resize grip stalled when the pointer crossed the pane's
  iframe; console and floating-console resizing now use the same drag shield as the
  split handles.
- Reloading a page no longer destroys your layout.
- A corrupt, unsupported or oversized stored layout can no longer break startup:
  it is ignored, logged, and a fresh single pane is rendered.
- A pane id collision after restoring into a page with more panes than before is
  impossible: the counter is restored to at least the highest id seen.

### Notes

- **Restoring recreates panes, so pages load fresh.** Scroll position, form input
  and in-page JS state cannot be carried over — that is a browser constraint, not a
  shortcut.
- **What is not persisted**: prompts, filter boxes, focus history and console
  scrollback (transient UI). Console open/height *is* persisted.
- Stored layouts contain plaintext URLs and titles of pages you opened, in your
  own browser profile (never `sync`, never uploaded). `persist off` clears the tab
  snapshot; `delete-layout` removes named ones.
- Extension reload/update clears `storage.session`, so the tab layout is lost —
  named layouts remain.
- On a browser without `storage.session`, the tab layer falls back to
  `storage.local` with a 6 hour expiry.

### Docs

- README leads with four real screenshots captured against
  [dtrh.net](https://www.dtrh.net/) — activation and a three-pane frost layout,
  `filter links` with boxes, a hovered match and the refine card, a detached
  console, and the classic palette for comparison. `docs/images/` holds them.
- README, QUICKSTART, COMMAND_USAGE, ADDING_COMMANDS and IMPLEMENTATION were
  re-checked against the code: every one of the 41 commands is documented in both
  the README tables and the command guide, and the stale "thick blue border",
  "70% console" and popup wording is gone.

### Verification

- `node --check` clean; all files kept CRLF; `manifest.json` parses.
- jsdom: **644 checks** pass, with the real `background/main.js` loaded as a second
  window and wired to in-memory `storage.session` / `storage.local`, so the tests
  exercise the shipped persistence path end to end: round trip (ratios, titles,
  zoom, active pane, ids, consoles), reload via a second content window, named
  layouts (save/list/restore/delete, origin scoping, surviving a reload), the off
  switch, corrupt/junk/unsupported/malformed snapshots, pane/depth/ratio/version
  caps, tab-close cleanup, startup pruning, exit saves, and debounce coalescing.
- Chromium 150 with the extension unpacked: **87 checks** pass, including a real
  `page.reload()` restoring two panes at a 30/70 split with the custom title and
  the maximize state, pages loading fresh after restore, `save-layout work` →
  `new-window` → `restore-layout work`, and `persist off` → reload → one pane.
- Not verified: a real browser restart (the harness cannot restart Chromium), the
  `storage.session` fallback path on a browser that lacks it, and touch input.

## [0.4.0] - 2026-11-09

Commands can be chained, commands can ask questions you can click, filters narrow
down in rounds, and every pane has its own maximize button.

### Added

- **Chained commands.** `;` runs commands one after another, from every entry
  point (debug console, `:` line, pane input, keys, relay):
  - `filter img; filter a` boxes both sets; `split-window -h; list-panes` does both;
  - a failing command does not stop the chain (shell `;` semantics), and each
    segment gets its own echoed line and result;
  - segments run awaited, so a prompt raised by one is answered before the next
    starts;
  - `\;` is a literal semicolon and `;` inside quotes or `[] () {}` does not split,
    so `filter a[href="x;y"]` stays one command.
- **Clickable prompts.** Commands can ask questions, and the answers are buttons
  in a card anchored above the pane's footer:
  - `api.ask({ question, details, choices })` and `api.askText({ question })` for
    command authors — the command simply awaits the answer and carries on;
  - a choice is picked by clicking, by its digit shortcut (`1`…`9`), by `Enter`
    for the primary choice, by `y`/`n` on yes/no prompts, or with the `yes`/`no`
    commands; `Esc` cancels;
  - the card never steals focus from a text field, and keys pressed with the focus
    inside the pane are caught too;
  - an open prompt is cancelled (not left hanging) when its pane is killed,
    navigates, or the overlay resets; yes/no prompts time out after 15s.
- **Per-pane maximize button.** Every pane footer has a `⤢` button that maximizes
  that pane and flips to `⤡` to restore it — the on-screen form of
  `Ctrl+b`, `Shift+z`. Clicking another pane's `⤢` moves the maximize there, and
  the glyphs stay in step with keyboard and toolbar zoom.
- **Filter refinement.** `filter` now draws and labels first, then offers to
  narrow the result in rounds:
  - *Inside a container…*, *Exclude a container…*, *Text contains…*, *Visible
    only*, *Unique targets*, *Keep these*, *Cancel* — each card is clickable;
  - every step intersects the current set, re-labels the boxes and re-asks, up to
    6 rounds;
  - the same narrowing is available non-interactively: `--in <selector>`,
    `--not-in <selector>`, `--text <word>`, `--visible`, `--unique [href|src|text]`;
  - `filter -y …` skips the questions entirely.
- **Filters accumulate.** A second filter on the same pane adds to the boxes
  already drawn instead of replacing them (`filter img; filter a`), which is what
  makes chained filters useful. `--replace` starts from a clean set and
  `filter -c` clears everything.

### Changed

- 0.3.0 asked *before* drawing for presets and >25 matches, and answered with a
  typed `yes`/`no`. Now it draws and labels first, then asks in a card — which is
  the flow the "23 a[href] found and labelled" example describes.
- `yes` / `no` answer whatever prompt is open (they map a missing choice onto the
  card's primary button), instead of only the filter confirmation.
- Filter state is a list of *parts* (`{ selector, test, uniqueBy }`) so an
  accumulated filter can be re-queried correctly when the page mutates.
- `filter`'s usage line and error text list the new flags.

### Fixed

- The pane console and debug console no longer accept a chain as one opaque
  command: both split on `;` and echo/report each segment.
- A prompt can no longer outlive its pane (kill, navigation, reset).
- The filter's own in-pane `Escape` handler stands down while a prompt is open, so
  `Esc` reaches the card first.

### Notes

- Refinement rounds narrow what is drawn; the mutation refresh re-queries the
  selector parts, so a page change after refining re-broadens the boxes to the
  full selector set (documented limitation).
- "Visible only" means rendered by the browser (not `display:none`,
  `visibility:hidden`, `opacity:0` or without boxes); it does not check the
  viewport.
- Chained filters keep appending until `filter -c` or `--replace`: a stray
  `filter div` after `filter a` adds div boxes rather than replacing them.
- Cross-origin panes still cannot be boxed, and cannot host a pane-scoped prompt
  card's keys (the card itself is in the top frame).

### Verification

- `node --check` clean; all files kept CRLF; `manifest.json` parses.
- jsdom: **559 checks** pass — tokenizer (quotes, brackets, `\;`, empty
  segments), chain order and continuation after an error, prompt rendering,
  clicking, digit/`Enter`/`Esc`/`yes`/`no` answers, text prompts, cancel-on-kill,
  per-pane maximize button and zoom reassignment, every refinement flag, the
  refinement round trip ending in *Keep these*, accumulation and `--replace`.
- Chromium 150 with the extension unpacked: **78 checks** pass — a preset drawing
  then asking, real clicks through Yes → Unique → No and Yes → Text → typed word →
  *Keep these*, `filter -y img; filter -y a` boxing three elements with both
  segments echoed, and the per-pane button maximizing and restoring with glyph
  changes.
- Not verified: touch input, cross-origin panes, the 15s prompt timeout in a real
  browser, and the mutation-refresh-after-refinement path (jsdom only).

## [0.3.0] - 2026-11-09

The pane console became usable (it opens, stays open, scrolls and resizes),
`filter` learned preset words and a yes/no confirmation, and `Shift+z` maximizes a
pane the way tmux does.

### Added

- **Pane console that stays put.** The console under each pane's input is now a
  real scrollback:
  - every command line and its result is appended (capped at 100 blocks) and the
    log scrolls, instead of the result replacing the previous one and then being
    hidden after five seconds;
  - it opens when a command produces output and **no longer auto-collapses**;
  - a toggle button in the footer (`▸` / `▾`) reopens or hides it at any time;
  - its top edge is a drag grip: drag to resize (minimum 40px, maximum 70% of the
    pane), double-click to reset to 140px;
  - the height and the open/closed state survive layout changes, zoom and
    swapping;
  - `log toggle|on|off|clear|size <px>` does the same from the command line, and
    the `l` key toggles it in Control Mode and after `Ctrl+b`.
- `clear` now empties the console scrollback.
- **Filter presets.** `filter <preset> [variant]` expands a word into a selector,
  and a variant can narrow it with a predicate that CSS cannot express:
  - `links` (`a[href]`) with `internal`, `external`, `empty`;
  - `images` (`img`) with `large`, `noalt`, `broken`;
  - `headings`, `text` (with `main`), `inputs`, `buttons`;
  - `tables` (with `rows`, `cells`), `media` (with `video`);
  - `prices`, `comments`, `authors`, `dates`, `articles` (with `headlines`),
    `forms`, `code`, `main`.
  - `filter --presets` prints the vocabulary with the selector each word expands
    to.
  - "Internal" means "resolves to the pane document's origin" (falling back to
    its base URI for documents without an origin of their own), so `#anchor` and
    `/path` links count as internal while `mailto:` and `https://elsewhere` do
    not.
- **Yes/no before drawing.** A preset, or any filter matching more than 25
  elements, asks first:
  `2 match(es) for links. Box them? Type "yes" / "no" (or press y / n; Esc
  cancels, "filter -y" skips this prompt).`
  - `yes` / `no` commands answer it, and `y` / `n` are hidden aliases, so the
    prompt works from the console, a pane input or the keyboard;
  - `y` / `n` / `Esc` answer it directly too, including with the focus clicked
    inside the page;
  - an unanswered prompt times out after 15 seconds and draws nothing;
  - `filter -y …` skips the prompt.
- **`Shift+z`** toggles pane zoom (Ctrl+b then Shift+z, or in Control Mode). `z`
  still works.
- The floating debug console can be resized by dragging its bottom-right corner.

### Changed

- Filter status and hover text use the preset name (`FILTER: links internal …`)
  instead of the raw selector when a preset was used, and listings show the
  preset beside the selector it expanded to.
- `help` skips commands marked `hidden` (currently the `y` and `n` aliases).

### Fixed

- The pane console could not be reopened after its five-second auto-collapse. The
  auto-collapse is gone, and the toggle button and `log toggle` can reopen it.
- The pane console could not scroll: `overflow-y: auto` now lives on the log
  element instead of on a panel that was `display: none` when idle.
- A pane console resized by drag kept its height only until the next command; the
  height is stored on the pane.

### Notes

- The console panel takes space from the pane's iframe while open (it is part of
  the pane's flex column), so a very tall console shrinks the page view — that is
  what the drag limit is for.
- Presets are only as good as the page's markup: `prices` and `comments` rely on
  conventional class/attribute names and will find nothing on a site that does not
  use them; plain selectors remain the escape hatch.
- Cross-origin panes still cannot be boxed at all, presets included.

### Verification

- `node --check` clean; all files kept CRLF; `manifest.json` parses.
- jsdom: **558 checks** pass — console open/close/toggle/drag/`log size`/`clear`
  and scrollback accumulation, preset resolution and variants (`links internal`
  excluding an off-site link), the confirmation prompt (`yes`/`no`/`y`/`n`/`Esc`,
  `-y`), `Shift+z` zoom, plus everything from 0.2.0.
- Chromium 150 with the extension unpacked: **65 checks** pass — the console
  opening on a command and still open after 5.3s, a real grip drag making it
  taller, `log off`/`log on` preserving the scrollback, a preset asking before
  drawing and `yes` boxing it, `filter -y links internal` boxing only the on-site
  link, and `Shift+z` maximizing and restoring.
- Not verified: touch input, cross-origin panes, and the 15-second prompt timeout
  in a real browser (jsdom covers the cancel path; the timeout itself is not
  exercised by either suite).

## [0.2.0] - 2026-11-09

`filter` became a visual tool: every match is boxed in the pane and named as you
pass over it.

### Added

- **Filter highlighting.** `filter <selector>` now draws a box around every match
  inside the pane — a 2px outline, a light wash and 7px corner ticks, so even a
  tiny or zero-height element is findable — with a numbered tab on each box.
- **Live element naming.** Moving the pointer over a match writes
  `FILTER: <selector> - <element> · <n>/<total>` into that pane's footer status
  line (the element's `TAG#id.class` plus a title, aria-label or text snippet),
  turns that box green, and falls back to
  `FILTER: <selector> · <n> match(es)` when the pointer leaves a match.
- **Live refresh.** A `MutationObserver` (debounced 300ms) re-queries the selector
  and redraws the boxes when the page changes underneath them, so matches added
  or removed after the filter was applied show up.
- **`filter -l <selector>`** lists matches without drawing anything.
- **`filter -n <max>`** caps how many boxes are drawn (default 200, hard ceiling
  1000) while still reporting every match.
- **`filter -c`** / `--clear` removes the boxes and the status line.
- **`Esc` clears the highlights** — from the top frame, from the debug console or
  a pane input, and from inside the pane itself (a pane document is a different
  frame, so the filter installs its own Escape listener for as long as the boxes
  are on screen). Highlights are cleared before Escape does anything else, so
  Control Mode and `display-panes` still get their own Escape afterwards.
- **`escape` command**, so a key pressed in a pane frame — which cannot see the
  top frame's filter state — resolves to the same behaviour: clear highlights if
  any, otherwise leave Control Mode.
- **Per-pane status segment** in the footer: yellow while filtered, green while
  naming a hovered match.

### Changed

- The boxes live in the pane's own document, positioned in document coordinates,
  so they scroll with the page and vanish with it. Nothing is drawn into the
  page's layout: no wrapper elements around page content, no attribute changes on
  page elements, no reflow.
- `filter` with no selector is now a usage error.
- Filter state is dropped when the pane navigates (`iframe` load), when the pane
  is killed, and when the overlay resets; the pane's Escape listener is removed
  with it.

### Notes

- **Same-origin only.** A cross-origin pane cannot be measured or written into, so
  `filter` reports why and draws nothing. Navigation, sizing and reordering still
  work there.
- Boxes reflect the DOM at the moment they are drawn. A page that moves elements
  without mutating the DOM (CSS transitions, scroll-driven layout) will not
  trigger the observer — re-run `filter` (or resize the window) to re-measure.
- Two panes can be filtered independently; `Esc` clears all highlights, `filter
  -c` clears the pane it was run for.

### Verification

- `node --check` clean; all files kept CRLF line endings.
- jsdom: **481 checks** pass, including boxes drawn per match, hover naming and
  index, hover class movement, `mouseleave` fallback, Escape from the top frame
  and from inside the pane document, `filter -c`, `-l`, `-n`, invalid selectors,
  the cross-origin refusal, and filter state dropped on kill.
- Chromium 150 with the extension loaded unpacked: **49 checks** pass, including a
  real `filter .box` on a live page (2 boxes injected into the pane document),
  real mouse hover producing `FILTER: .box - DIV.box "one" · 1/2` and then
  `· 2/2` for the second element, Escape clearing the boxes from the console
  focus and from inside the pane, and `filter -c`.
- Not verified: cross-origin panes (every browser check is same-origin), the
  MutationObserver refresh path in a real browser (jsdom only), and touch input.

## [0.1.0] - 2026-11-09

A ratio-driven layout engine, real pane management, and one command registry that
every entry point shares.

### Added

- **Ratio-driven layout engine**
  - The layout is a binary split tree — `leaf` or `split(direction, ratio)` — and
    `split-window`, `kill-pane`, `resize-pane`, zoom, layout presets, `swap-pane`
    and `rotate-window` all edit that tree and recompute rectangles.
  - Panes are absolutely positioned inside `#bmux-panes` from fractional
    rectangles, so resizing the browser window keeps every pane proportional.
  - **Pane elements are never moved in the DOM.** Splitting, changing layout,
    swapping and rotating therefore no longer reload the pages in the panes.
    (Until 0.0.1, splitting reparented the iframe, and reparenting an iframe
    reloads it.)
- **Mouse resizing**: one draggable handle per split boundary — 8 px hit area, a
  hairline marker, a hover highlight and a `col-resize`/`row-resize` cursor.
  Double-clicking a handle resets that split to 50/50. While dragging, a
  full-overlay shield keeps the pointer off the pane iframes, which would
  otherwise swallow the events that drive the drag.
- **`split-window` sizes and placement**: `-l <size>` / `-p <size>` (`30%`, `30`
  or `0.3`), `-b` (put the new pane first), `-d` (keep focus on the pane being
  split). Splits are clamped to 10–90%.
- **`kill-pane`** is real: it closes a pane, gives the space back to its
  neighbour, moves focus sensibly, and refuses to kill the last pane.
- **`resize-pane`**: `-L/-R/-U/-D <percent>` moves the adjacent boundary,
  `-x <size>` sets the pane's share of its parent, `-Z` toggles zoom.
- **Zoom**: a pane can fill the overlay while the other panes keep running (they
  are hidden, not destroyed). Marked `[ZOOM]` in `list-panes` and `· ZOOM` in the
  status bar; any directional focus move unzooms first.
- **Layout presets**: `select-layout even-horizontal|even-vertical|main-vertical|
  main-horizontal|tiled`, and `next-layout` (`Space` in Control Mode) to cycle.
- **Pane titles**: `rename-pane <title>` (or `-` to clear). The footer shows the
  title, derived from the page `<title>` when same-origin or from the URL
  otherwise.
- **`swap-pane`** and **`rotate-window`**: reorder panes without reloading any
  page.
- **`display-panes`**: shows each pane number over the pane; press a digit to
  focus that pane, `Escape` cancels (`q` in Control Mode).
- **`capture-pane [-n <lines>]`**: prints the pane's visible text (same-origin).
- **`list-panes`** now shows size and title and accepts `-j|--json` for tooling.
- **`cycle-pane [next|prev]`** and **`last-pane`** (`o` and `;`).
- **Directional pane focus** (from the unreleased work on this branch, first
  shipped in 0.1.0):
  - `Up` / `Down` / `Left` / `Right` toolbar buttons, each running
    `focus-pane <direction>` through the shared dispatcher.
  - Arrow keys move focus in Control Mode and after the `Ctrl+b` prefix,
    with wrap-around at the edge of the layout.
  - Picking is geometric: the nearest pane whose centre lies in that direction,
    with a penalty for drifting off-axis; with nothing in that direction, focus
    wraps to the pane furthest on the opposite side.
  - Click to focus on a pane's body or footer, and inside its iframe (via the
    window blur/`activeElement` sync, which also works cross-origin).
- **Pane identity**: ids `%N` assigned once and never reused, reading-order
  numbers, a `[number id]` footer badge, and the focused pane in the status bar.
- **Overlay commands from the console**: `list-panes`, `focus-pane`,
  `split-window`, `kill-pane`, `resize-pane`, `select-layout`, `swap-pane`,
  `rotate-window`, `new-window`, `detach`, `control-mode` and `command-prompt` can
  be typed in the debug console, the `:` line or a pane's input.
- **`BMUX_KEYBINDINGS`**: both key tables are command lines in
  `content/commands.js`; `Alt+arrow` resizes, `z` zooms, `q` shows numbers, `o`
  and `;` cycle and return, `Space` cycles layouts.
- Toolbar gains `Zoom` and `Layout` buttons.

### Changed

- `content/commands.js` is the single source of truth for commands: every command
  (overlay and pane) defines `scope`, `description`, `usage` and
  `execute(api, args)`. `content/main.js` holds no command definitions, no help
  text and no key-to-action switch — it parses a line, looks the name up
  (own-property lookup) and calls `execute`.
- Toolbar buttons, the debug console, the `:` line, pane inputs, both key tables
  and the background relay all run the same dispatcher.
- Panes are numbered by **layout order** (top-to-bottom, left-to-right), so
  numbers follow the picture instead of the order panes were created in.
- The background relay carries a command line (`relay-line` → `execute-line` with
  `{ line }`) instead of `action`/`params`; the background knows no command names.
- `setControlMode(on)` replaces the toggle-only implementation; `control-mode
  on|off|toggle` and `Escape` share that one path.
- `split-window` still clones the active pane's URL into the new pane, but the
  original pane is no longer reparented.
- Attaching the overlay no longer leaves focus inside a hidden command input.
- The debug console no longer gets a duplicate "Split …" line for each split.
- `help` is generated from the registry and grouped by scope.

### Fixed

- **Prototype names can no longer resolve as commands or keys** —
  `constructor`, `__proto__` and `hasOwnProperty` report `Unknown command`.
- **Bad arguments never throw**: unknown pane/number/id, unknown flags, missing
  arguments and invalid sizes return a message and leave the layout and focus
  untouched; a throw inside a command is caught and reported.
- Space could not trigger a binding (`event.key` is `' '`, not `'Space'`).
- Mouse resizing stopped as soon as the pointer crossed a pane iframe.
- `resize-pane` used to refuse a direction with no neighbour on that side; every
  direction now moves the adjacent boundary.
- `rotate-window` rotated the wrong way (panes moved to the previous slot).
- Control Mode key handling no longer dereferences an overlay UI that pane frames
  do not have.
- The `:` line's open state is tracked explicitly, so keys are no longer
  swallowed when the command input has focus before the line was ever opened.
- Pane output no longer shows an empty box for commands that return nothing.

### Notes

- Still not implemented: floating panes, break/join pane, multiple windows or
  layout tabs, sessions/persistence, and broadcasting input to all panes.
- `kill-pane` never kills the last pane; use `new-window` to reset instead.
- `new-window` still resets the overlay to a single pane.
- `Escape` closes the `:` line and leaves Control Mode on; a second `Escape`
  leaves Control Mode.
- Mouse resizing needs a mouse: touch input is not handled.
- Cross-origin panes cannot be inspected (`source`, `filter`, `capture-pane`);
  navigation, reload, sizing and reordering work regardless of origin.
- `docs/DESIGN.md`, `docs/UPDATE_STATUS.md` and the 0.0.1 section of
  `RELEASE_NOTES.md` are kept as historical documents and were not rewritten.

### Verification

- `node --check` on every changed script; all edited files kept CRLF line endings.
- **jsdom harness** (`content/commands.js` + `content/main.js` loaded as the
  manifest loads them, same script order, one global scope): **439 checks**,
  covering the dispatcher, both key tables, the `:` line, pane inputs, the debug
  console, click-to-focus, wrap-around, split sizes/`-b`/`-d`, kill, resize,
  zoom, all five layouts, swap/rotate, mouse drag and clamp, display-panes,
  titles, capture-pane, list-panes text and JSON, bad input, ids/numbers/badges,
  and the background relay.
- **No-reload proof in the harness**: after three layout presets, a swap, a
  rotation, a resize and another split, every pane element is still the same
  connected node, still a direct child of `#bmux-panes`, and still owns the very
  same `<iframe>` element.
- **Real browser** (unpacked extension in Chromium 150, headless,
  puppeteer-core): **36 checks**, including mouse-dragging a split handle
  (592 → 392 px), `z` zoom and unzoom, `Space` layout cycling, `main-vertical`,
  `swap-pane`, `Alt+Arrow` resizing, `rename-pane`, `capture-pane`, killing panes
  down to the last one, arrow focus, no uncaught page errors, and a live marker
  set on the pane iframe's window that survives splitting, zooming, layout
  changes and swapping — the direct evidence that no page was reloaded.
- **Not covered by any run**: the `Alt+Shift+B` global hotkey (a browser-level
  command that cannot be synthesised from DevTools; the browser harness un-hides
  the overlay directly), the popup buttons, the `Ctrl+b` prefix in a real
  browser, `chrome.storage` state, and cross-origin panes (every browser check ran
  same-origin). Google Chrome 157 rejects `--load-extension`, so the browser run
  used `chromium`.
- Both harnesses are local only (`.verify/`, gitignored; they need `jsdom` and
  `puppeteer-core`) and are not part of the extension.

## [0.0.1] - 2025-12-09

### Initial Release

#### Added
- **Core multiplexing functionality**
  - Horizontal and vertical pane splitting
  - Unlimited nested splits
  - Current page URL cloning on split

- **Dual control systems**
  - Control Mode (Alt+Shift+B) with direct key commands
  - Legacy TMUX-style (Ctrl+b) prefix mode

- **Per-pane command system**
  - Green `>` prompt at bottom of each pane
  - Extensible command registry in `content/commands.js`
  - Built-in commands: help, source, restore, filter, url, reload, clear

- **Global debug console**
  - Draggable floating console
  - Executes commands on active pane
  - Full scrollback history

- **Console view mode**
  - `source` command transforms pane to terminal view
  - Displays HTML source with syntax escaping
  - `restore` command returns to browser view

- **CSP header removal**
  - Uses declarativeNetRequest API
  - Allows loading GitHub, Google, Facebook, etc. in iframes
  - Only affects BMUX panes (not main page)

- **Cross-origin safety**
  - Helper functions for safe iframe access
  - Graceful error messages for restricted content
  - Fallback strategies for URL detection

- **Modern UI**
  - Glassmorphism design with backdrop blur
  - Dark theme optimized for readability
  - Visual indicators (blue border for active pane)
  - Responsive layouts

- **Documentation**
  - Comprehensive README.md
  - 7 detailed guides in docs/ folder
  - Command development tutorial
  - Security and privacy documentation

#### Technical Details
- Manifest V3 browser extension
- Content scripts with iframe support
- Background service worker for state management
- Declarative net request rules
- Modular command architecture

#### Browser Compatibility
- Chrome/Edge: Full support
- Firefox: Manifest needs minor adjustments (not yet tested)

### Known Limitations
- State persistence not fully implemented (panes don't survive page reload)
- No pane resizing with mouse
- No arrow key navigation
- No session management
- Some sites with JavaScript iframe busters may not work

### Security Notes
- Requires `<all_urls>` permission for CSP removal
- All code is open source and auditable
- No data collection or external requests
- Local storage only

---

## Planned for 0.6.0

- Floating panes (a pane that overlays the layout instead of taking space)
- `break-pane` / `join-pane`
- Multiple windows / layout tabs with their own layouts
- Session persistence (save and restore layouts, titles and URLs)
- Broadcasting input to all panes
- Pane drag-and-drop reordering with the mouse
- Touch/pointer-based resizing
- State persistence in `chrome.storage`
- Better error handling and recovery

### Future Considerations
- Plugin/extension system
- Custom themes
- Cloud sync (optional)
- Firefox full compatibility
- Performance optimizations
