/**
 * BMUX script files (`.bmux`) — the format, the parser and the built-in demo.
 *
 * A `.bmux` file is a list of command lines, run in order by `script run`. It is
 * deliberately not a programming language: there are no variables, no conditionals
 * and no loops, because every line is exactly what you would type at the `:` line
 * or into a pane console — so anything you can do by hand you can put in a file,
 * and anything you put in a file you can paste into the console and run by hand.
 *
 *   # comment              (also //, and a leading #!)
 *   sleep 1.5              pause between steps — this is what paces a demo
 *   split-window -h -l 62% one command per line
 *   filter img; filter a   `;` still chains inside a line
 *
 * Loaded before content/commands.js (see manifest.json), so the commands can call
 * these helpers. The runner itself lives on the client: `bmux.runScript()`.
 */

/** Parsing and pacing limits, all deliberately generous but bounded. */
const BMUX_SCRIPT_MAX_COMMANDS = 500;
const BMUX_SCRIPT_MAX_LINE = 2000;
const BMUX_SCRIPT_MAX_BYTES = 65536;
const BMUX_SLEEP_MAX_SECONDS = 3600;
const BMUX_SLEEP_DEFAULT_ARG = '1';

/** Printable forms of a pause, used in log lines. */
function bmuxFormatSeconds(seconds) {
    const value = Number(seconds);
    if (!isFinite(value) || value < 0) return '0s';
    if (value === 0) return '0s';
    if (value < 1) return `${Math.round(value * 1000)}ms`;
    return Number.isInteger(value) ? `${value}s` : `${value}s`;
}

/**
 * Parse a `sleep` argument: bare seconds (`2`, `1.5`), or with a unit
 * (`250ms`, `2s`, `1.5 min`-free). Returns `{ ok, seconds }` or `{ ok:false,
 * error }` — never throws, so a bad line reports itself instead of killing a run.
 */
function bmuxParseSleepArg(arg) {
    const raw = (arg == null ? '' : String(arg)).trim().toLowerCase();
    const text = raw === '' ? BMUX_SLEEP_DEFAULT_ARG : raw;

    const match = text.match(/^([0-9]*\.?[0-9]+)\s*(ms|s|sec|secs|second|seconds)?$/);
    if (!match) {
        return { ok: false, error: `Sleep takes seconds: "2", "0.5", "250ms" (got "${arg}")` };
    }

    const value = parseFloat(match[1]);
    const unit = match[2] || 's';
    const seconds = unit === 'ms' ? value / 1000 : value;

    if (!isFinite(seconds) || seconds < 0) {
        return { ok: false, error: `Sleep needs a positive number of seconds (got "${arg}")` };
    }

    if (seconds > BMUX_SLEEP_MAX_SECONDS) {
        return { ok: false, error: `Sleep is capped at ${BMUX_SLEEP_MAX_SECONDS}s` };
    }

    return { ok: true, seconds: seconds };
}

/** `2s` / `500ms` for a pause already known to be valid. */
function bmuxSleepLabel(seconds) {
    return bmuxFormatSeconds(seconds);
}

/**
 * Turn `.bmux` text into the commands to run.
 *
 * Returns `{ ok: true, commands: [{ index, text, sleep }] }` where `sleep` is the
 * parsed pause for a `sleep` line (so the runner can show "sleeping 2s" instead of
 * treating it like any other command), or `{ ok:false, error }` with the offending
 * line number. Blank lines and comments are counted for error messages but not
 * returned, so `index` is the command ordinal shown as `[3/18]`.
 */
function bmuxParseScript(text) {
    const source = text == null ? '' : String(text);

    if (!source.length) return { ok: false, error: 'The script is empty' };
    if (source.length > BMUX_SCRIPT_MAX_BYTES) {
        return { ok: false, error: `The script is larger than ${BMUX_SCRIPT_MAX_BYTES} bytes` };
    }

    const rawLines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
    const commands = [];

    for (let i = 0; i < rawLines.length; i++) {
        const lineNo = i + 1;
        let line = rawLines[i].trim();

        if (!line) continue;
        if (line.charAt(0) === '#' || line.indexOf('//') === 0) continue;

        // A pasted transcript keeps its prompt: `> split-window -h`.
        if (line.charAt(0) === '>' || line.charAt(0) === '$') {
            line = line.slice(1).trim();
            if (!line) continue;
        }

        if (line.length > BMUX_SCRIPT_MAX_LINE) {
            return { ok: false, error: `Line ${lineNo} is longer than ${BMUX_SCRIPT_MAX_LINE} characters` };
        }

        if (commands.length >= BMUX_SCRIPT_MAX_COMMANDS) {
            return {
                ok: false,
                error: `The script has more than ${BMUX_SCRIPT_MAX_COMMANDS} commands — split it into two files`
            };
        }

        const entry = { index: commands.length + 1, line: lineNo, text: line, sleep: null };
        const keyword = line.split(/[\s;]/)[0].toLowerCase();

        if (keyword === 'sleep') {
            const arg = line.slice(keyword.length).trim();
            const parsed = bmuxParseSleepArg(arg);
            if (!parsed.ok) {
                return { ok: false, error: `Line ${lineNo}: ${parsed.error}` };
            }
            entry.sleep = parsed.seconds;
        }

        commands.push(entry);
    }

    if (!commands.length) {
        return { ok: false, error: 'The script has no commands (only comments and blank lines)' };
    }

    return { ok: true, commands: commands };
}

/**
 * The built-in demo: what `script demo` runs, and the same text as the shipped
 * `examples/demo.bmux`. Every step is a real command; the pauses are the only
 * thing that makes it a recording rather than a single frame.
 */
const BMUX_DEMO_SCRIPT = `#!/usr/bin/env bmux
# demo.bmux — the BMUX show-off. One step every couple of seconds.
#
# Run it:  activate BMUX (Alt+Shift+B), then  :  script file   -> pick this file -> Run
# Or:      : script demo     (runs the built-in copy of this script)
#
# A script cannot click, so prompts are skipped with -y. Run "filter links" by
# hand to see the clickable confirmation card. Reload, a new tab and named-layout
# restore across a restart have to be done by hand too — a script does not survive
# the navigation it would need.

sleep 1
reset-layout
sleep 1.2

# 1 . a useful three-pane layout, built without reloading anything
split-window -h -l 62%
sleep 0.8
focus-pane 2
split-window -v -l 45%
sleep 1.2
focus-pane 1
rename-pane main
sleep 0.4
focus-pane 2
rename-pane docs
sleep 0.4
focus-pane 3
rename-pane tools
sleep 1.6

# 2 . rearranging: presets, swap, rotate, zoom — pages keep their state
select-layout main-vertical
sleep 1.6
swap-pane 1 2
sleep 1.2
rotate-window
sleep 1.2
select-layout tiled
sleep 1.6
focus-pane 1
resize-pane -Z
sleep 1.6
resize-pane -Z
sleep 1

# 3 . visual filters: boxes, hover names, then narrow in rounds
focus-pane 2
filter links -y
sleep 2.4
filter --text http --visible
sleep 2
filter -c
sleep 1
filter img -y; filter a -y
sleep 2.4
escape
sleep 1.2

# 4 . persistence: named layouts for this site
save-layout demo
sleep 1.2
list-layouts
sleep 2
restore-layout demo
sleep 1.2
persist status
sleep 1.6

# 5 . the pane console, detached, and the palette
focus-pane 1
verbose on
sleep 0.6
log on
sleep 1
log size 240
sleep 1.4
log detach
sleep 2.4
log attach
sleep 1.2
theme classic
sleep 2.4
theme frost
sleep 1.4

# 6 . windows: a second layout in the same tab, switched instantly
new-window docs
sleep 1.2
split-window -v -l 45%
sleep 1.2
rename-window docs
sleep 0.6
list-windows
sleep 2.2
previous-window
sleep 1.6
next-window
sleep 1.4
select-window 1
sleep 1.4

# 7 . polish
display-panes
sleep 2
info layout
sleep 2.6
verbose off
help
sleep 3
focus-pane 1
theme frost
`;
