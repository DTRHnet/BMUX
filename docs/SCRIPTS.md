# `.bmux` script files

A `.bmux` file is a list of commands that BMUX runs in order, one line at a time,
with `sleep` between the steps. It is how you record a demo, how you show someone
a layout without describing it, and how you turn a long sequence of commands you
keep typing into one word.

It is deliberately **not** a programming language: there are no variables, no
conditionals, no loops and no expressions. Every line is exactly what you would
type at the `:` line or into a pane console — so anything you can do by hand you
can put in a file, and anything in a file you can paste into a console and run by
hand when you want to watch it happen more slowly.

---

## Format

```bmux
#!/usr/bin/env bmux
# Comments start with # (or //), and blank lines are ignored.
# A leading ">" or "$" is stripped, so a pasted transcript still runs.

sleep 1                          # pause 1s between steps
new-window                       # one command per line
split-window -h -l 62%
filter img; filter a             # ";" still chains inside a line
sleep 2.5
```

| Line | Meaning |
|------|---------|
| blank | ignored |
| `# …` / `// …` | comment, ignored (`#!…` too) |
| `> cmd` / `$ cmd` | the prompt is stripped, then run as a command |
| `cmd` | one command, with the same arguments and `;` chaining as in the console |
| `sleep <seconds>` | wait before the next line |

### `sleep`

```
sleep 1        one second (bare numbers are seconds)
sleep 0.5      fractions are fine
sleep 250ms    milliseconds with a unit
sleep 2s       2 seconds, spelled out
sleep          no argument means 1 second
```

- Capped at 3600 s per line; anything longer is refused with the reason.
- A pause is **cancellable**: `script stop` (or the Stop button) ends it
  immediately and the script does not run its next command, so a `sleep 30` never
  holds the overlay hostage.
- `sleep` is an ordinary command, so it works outside a script too:
  `> sleep 2; list-panes` waits, then lists.
- The script is *not* blocked behind it in a way that freezes the browser: the
  overlay stays live, panes keep loading, prompts still appear.

### Limits

| Limit | Value | Why |
|-------|-------|-----|
| commands per script | 500 | a demo, not a build system |
| characters per line | 2000 | keeps a line to one command |
| file size | 64 KB | same |
| concurrent scripts | 1 | one runner, one stop button |
| nested `script run`/`script demo` | refused | otherwise `script stop` could not stop the inner one |

A script that breaks a limit is refused **whole**, with the line number that
broke it: nothing runs half-way.

---

## Running a script

Activate BMUX first (`Alt+Shift+B`, or click the icon) — a script runs inside the
overlay, from the page it is activated on.

| Command | What it does |
|---------|--------------|
| `script demo` | load the built-in demo and run it |
| `script open` | show the script panel (paste commands into it) |
| `script file` | pick a `.bmux` file from disk and load it into the panel |
| `script file --run` | same, and start it as soon as it loads |
| `script run` | run whatever is in the panel |
| `script stop` | stop after the current command, or cut a `sleep` short |
| `script status` | panel state, loaded line count, and what the runner is doing |
| `script close` | hide the panel (a running script keeps running) |

The panel has the same buttons — **Run**, **Stop**, **File**, **×** — and
`Ctrl+Enter` runs what is in the textarea. `script file` opens the browser's own
file picker; if a browser ever refuses to open it from a typed command (activation
rules differ), the panel's **File** button is the same call from a real click. Its progress line always names the
command being run (`7/73 · select-layout main-vertical`), and turns ice-blue while
a script is running.

```bmux
> script demo
Script "demo.bmux": ran 73 command(s)
```

Every step is echoed into the debug console with its index (`[7/73] …`) and its
result, so the transcript of a run is the same transcript you would get by typing
it all yourself.

### A script that fails in the middle keeps going

Same rule as `;` chains: a command that errors is logged and the next line still
runs, because a demo that dies on one missing preset is useless. The run ends with
a count:

```
Script "demo.bmux": ran 73/73, 2 command(s) reported an error (see the log)
```

---

## What a script cannot do

- **Click.** A prompt (the filter confirmation card) needs a person. Scripts skip
  prompts with `-y` (`filter links -y`); run `filter links` by hand to show the
  card. A script that *does* open a prompt waits for its answer or the 15-second
  timeout.
- **Survive a navigation.** A reload, a new tab and the persistence round trip
  destroy the content script that is running the script. Do those by hand — the
  demo script stops short of them for exactly this reason.
- **Read or write files, or use the network.** It is a command list, not code.
- **Loop or branch.** If you need 20 panes, write 20 lines; if you need it
  conditional, type the commands.
- **Run in the background.** It runs in the tab you started it in, in the overlay
  you can see.

---

## Writing a demo script

The pacing is the whole trick. From the shipped
[`examples/demo.bmux`](../examples/demo.bmux) - 73 commands, about 50 s:

| Step | Pause before the next line |
|------|----------------------------|
| a structural change (`split-window`, `select-layout`, `theme`) | 1.0 – 1.6 s |
| something the viewer must read (`list-layouts`, `help`, `info layout`) | 2.0 – 3.0 s |
| a filter being drawn and left on screen | 2.0 – 2.4 s |
| a quick confirmation of state (`save-layout`, `persist status`) | 0.6 – 1.2 s |

Other habits worth copying:

- **Start from a clean slate**: `sleep 1` then `new-window`, so the demo does not
  depend on what the tab looked like before.
- **Name the panes** (`rename-pane main`) — the titles make the subsequent swap,
  rotate and zoom legible instead of anonymous boxes.
- **Leave the reader oriented**: after a rotation or a preset change, a 1.2 s
  pause is enough; after `help`, three seconds is not too long.
- **Do not end on a transient state.** The demo closes with `theme frost` and
  `focus-pane 1` so the final frame is a stable, presentable layout.
- **Keep it under a minute.** `examples/demo.bmux` runs about 50 s including the
  command time; longer demos lose the room.

### The shipped demo, step by step

`examples/demo.bmux` (identical to what `script demo` runs) walks through:

1. **A useful three-pane layout** — `new-window`, two splits, then a title per
   pane (`main`, `docs`, `tools`).
2. **Rearranging without reloads** — `select-layout main-vertical`, `swap-pane`,
   `rotate-window`, `select-layout tiled`, then `resize-pane -Z` twice to zoom in
   and back out. The pages never reload; scroll positions survive.
3. **Visual filters** — `filter links -y`, then `--text http --visible` to narrow
   the same matches in place, `filter -c` to clear, then a chained pair
   (`filter img -y; filter a -y`) and `escape`.
4. **Persistence** — `save-layout demo`, `list-layouts`, `restore-layout demo`,
   `persist status`.
5. **Console and palette** — `verbose on`, `log on`, `log size 240`,
   `log detach`, `log attach`, `theme classic`, `theme frost`.
6. **Polish** — `display-panes`, `info layout`, `verbose off`, `help`.

---

### A tour of one site

[`examples/dtrh-tour.bmux`](../examples/dtrh-tour.bmux) is the same idea with real
pages in the panes: right after a split the new pane is focused, so
`split-window` + `url` + `rename-pane` in that order is deterministic. It is the
script behind the README screenshot and the recording. To tour your own site,
change the two `url` lines and the three titles - nothing else is site-specific.

## Recording it

The script does the clicking; you only have to capture the window.

1. Activate BMUX on a page with real content - the recorded tour was made on
   <https://www.dtrh.net/>, with `examples/dtrh-tour.bmux`.
2. Optional but recommended: `debug on` so the command echoes are visible in the
   floating console, or `verbose on` inside the script to mirror them into the
   pane console.
3. Start your recorder, then run `script demo` (or `script file --run` with your
   own file).
4. Stop recording when the progress line says `finished`.

Practical notes:

- 1440×900 with the browser UI hidden is a good frame; the panel sits bottom-left
  and shows the command being run, which reads well on video.
- If you want a longer pause on one step, edit the copy in your file — the demo is
  plain text, and `script run` re-runs the panel's current contents.
- A screen recorder that captures at 30 fps will drop nothing: the script holds
  each state for at least half a second.

---

## Where the pieces live

| File | Role |
|------|------|
| `content/scripts.js` | the format: `bmuxParseScript`, `bmuxParseSleepArg`, and the built-in `BMUX_DEMO_SCRIPT` |
| `content/main.js` | the runner: `runScript`, `stopScript`, `sleepSeconds`, the panel |
| `content/commands.js` | the `sleep` and `script` commands |
| `examples/demo.bmux` | the shipped demo, byte-identical to the built-in one |
| `examples/dtrh-tour.bmux` | the site tour used for the screenshot and the recording |

See also: [COMMAND_USAGE.md](COMMAND_USAGE.md) for every command,
[ADDING_COMMANDS.md](ADDING_COMMANDS.md) for adding one.
