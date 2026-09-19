<h1 align="center">pult</h1>

<p align="center">
  <a href="https://github.com/drakulavich/pult/actions/workflows/test.yml"><img src="https://github.com/drakulavich/pult/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
  <a href="https://code.claude.com/docs/en/statusline"><img src="https://img.shields.io/badge/Claude%20Code-statusLine-d97757" alt="Claude Code statusLine"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center"><b>One line of status under your Claude Code prompt.</b><br>Model, context, spend, rate limits, repo and branch — read from the session JSON Claude Code already pipes you, printed in about 65 ms.</p>

<p align="center">
  <img src="docs/assets/statusline.png" alt="pult rendering a status line: model, context percentage and tokens, cost and duration, lines changed, both rate-limit windows, repo and branch" width="900">
</p>

A busier session fills in the rest — a reset time once a window has gone yellow, and the pull request you are on:

```
Fable 5.1 │ ctx 41% of 1M │ $4.21 · 1h30 │ +156/-23 │ 5h 24% · 7d 81% ↻3d11h │ kesha-voice-kit:main │ PR #1150 approved
```

- **Everything on one row** — nothing wraps, nothing scrolls, and sections you have no data for are simply absent
- **Colored where it counts** — context and rate-limit percentages go yellow at 50% and red at 80%; a `*` after the branch means uncommitted tracked changes
- **Nothing to install to run it** — a POSIX `sh` wrapper and one TypeScript file that Bun runs directly, with no build step. The only devDependency is `tsc`, which the typecheck and CI use
- **Never breaks your prompt** — a bad payload or a missing Bun prints one dim line and exits 0, so a crash can never end up in your status line

## Quick start

Bun is the only requirement.

```sh
# 1. Install Bun (skip if you have it)
curl -fsSL https://bun.sh/install | bash        # macOS/Linux — or: brew install oven-sh/bun/bun

# 2. Clone it wherever you like; ~/.claude is a tidy home
git clone https://github.com/drakulavich/pult.git ~/.claude/pult

# 3. Try it by hand before wiring it up
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":12}}' | ~/.claude/pult/pult
```

Then add this to `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/pult/pult",
  "refreshInterval": 30
}
```

Claude Code reads that at startup, so the line appears in your next session. It runs the command through a shell, which is why the `~` expands; if you cloned somewhere else, the command is just that path instead. Add ` --zapara` to the command for [today's load](#todays-load-from-zapara), if you use zapara.

Windows routes the command through Git Bash and should run the wrapper unchanged. Nobody has tried it.

### Why there is a wrapper

`pult` is a small shell script, and it exists so that no absolute path of yours ends up in the install:

- It walks its own symlink chain to find `pult.ts` beside itself, so the clone can live anywhere and can be linked onto your `PATH` (`ln -s ~/.claude/pult/pult ~/.local/bin/pult`) if you would rather type `pult`.
- It looks for `bun` on `PATH`, then `$BUN_INSTALL/bin`, `~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin` and Linux Homebrew. A status line runs outside your shell profile, where `bun` is often missing even though your terminal finds it fine. When no Bun turns up the line reads `statusline: bun not found` instead of going blank.

## Codex CLI

Codex CLI has its own native status line. It does not invoke Pult or send a
Claude Code-style JSON payload, so Pult cannot replace the Codex footer.

To get the native Codex line shown below, first open an interactive Codex
session and enter `/statusline`. Select and order the items in this order:

```toml
[tui]
status_line = [
  "model-with-reasoning",
  "project-name",
  "git-branch",
  "branch-changes",
  "context-used",
  "weekly-limit",
  "used-tokens",
]
```

This produces a compact line such as `gpt-5.6-terra high · pult · main · No
changes · Context 27% used · weekly 77% left · 389K used`. `/statusline` saves
the same selection to Codex's user configuration, so using the picker is the
safest way to configure it and preview the result.

The [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents `tui.status_line` in `~/.codex/config.toml` as an ordered list of
Codex-provided footer-item identifiers. The [Codex status-line source](https://github.com/openai/codex/blob/5eea8d0d/codex-rs/tui/src/bottom_pane/status_line_setup.rs#L51-L145)
defines the available items; Codex may add or change them, so use `/statusline`
to explore your installed version. Pult never changes this configuration file.

| Pult / Claude Code value | Codex native equivalent | Notes |
|---|---|---|
| Model and reasoning effort | `model-with-reasoning` | Native equivalent |
| Context window and current-session tokens | `context-used`, `context-window-size`, `used-tokens` | The example uses context percentage and session tokens; add window size if useful |
| Repository and branch | `project-name`, `git-branch` | Native equivalents when available |
| Pull request | `pull-request-number` | Native equivalent when available |
| Changed lines | `branch-changes` | Committed branch changes relative to the default branch, not Pult's current-session totals |
| Estimated cost | `estimated-thread-cost` | Enterprise-only and may be unavailable |
| 5-hour / 7-day limits | `five-hour-limit`, `weekly-limit` | Codex reports remaining usage; availability is account-dependent |
| Agent or worktree name | None | No documented equivalent |

Pult does not read `~/.codex` session data, scrape the TUI, modify
`~/.codex/config.toml`, or use `notify` or hooks to imitate a Codex status-line
renderer.

## What the line shows

Left to right, with the payload field each section comes from. The fields are documented at [code.claude.com/docs/en/statusline](https://code.claude.com/docs/en/statusline).

| Section | Comes from | Notes |
|---|---|---|
| `Fable 5.1 fast,low` | `model.display_name` | Falls back to `model.id`, then `?`. Appends `fast` and the effort level unless it is `high` |
| `ctx 41% of 1M` | `context_window` | Uses `used_percentage` when the payload has it, otherwise adds up `current_usage` against the window size. The size is printed, the token count is not |
| `$4.21 · 1h30` | `cost.total_cost_usd`, `total_duration_ms` | A thousand dollars becomes `$1k`, a day becomes `1d0h`; the minutes go with it |
| `+156/-23` | `cost.total_lines_added`, `total_lines_removed` | Thousands to a tenth from a thousand, `+11.1k/-348`; hidden when both are zero |
| `5h 24% · 7d 81% ↻3d11h` | `rate_limits.five_hour`, `seven_day` | The `↻` reset time appears once a window has gone yellow, so a quiet session shows percentages alone |
| `load 36 · streak 2h46 · day 9h15` | `~/.claude/zapara/status.json`, with `--zapara` | This hour's cognitive load index from [zapara](https://github.com/drakulavich/zapara), coloured by its level, then the time since a break and the day's active time, grey until they matter; `load -` in an hour with no activity yet, all dim once the file is older than five minutes. See [Today's load from zapara](#todays-load-from-zapara) |
| `pult:main*` | `workspace.repo.name`, then git | The payload's repo name, an empty one counting as no name, else the repository `git` reports, else the last segment of the working directory. The branch comes from `git` in that directory, so it is empty outside a repo |
| `(wt review)` | `worktree.name`, `workspace.git_worktree` | Collapses to `(wt)` when the worktree is named after the branch already shown. Both fields are names, so either prints whole; an empty one counts as no name |
| `PR #1150 approved` | `pr.number`, `pr.review_state` | The state is printed only when it asks for something: `approved` green, `changes_requested` red, `draft` dim. A `pending` review, which is most of them, leaves the number alone |
| `agent explorer` | `agent.name` | |

Every percentage is whole and capped at 100, so the number printed is the one the colour follows, and the one the `↻` reset time appears alongside.

Absent data drops its section rather than rendering a zero or a placeholder, so the line stays short in a fresh session and grows as the session does.

## Today's load from zapara

[zapara](https://github.com/drakulavich/zapara) reads your Claude Code transcripts and scores each hour's cognitive load from 0 to 100. That scan takes longer than a status line should, so zapara does not run on every render: `zapara status` writes the current hour to `~/.claude/zapara/status.json`, one line of JSON, and pult reads that file. The segment is off unless the command in `settings.json` ends with `--zapara`, because keeping the file fresh means starting zapara, and not everyone has it:

```json
"command": "~/.claude/pult/pult --zapara"
```

With the flag, every render reads the file and prints `load 36` in the colour of zapara's level for that number: calm green, warming yellow, heating red, fried bold red. Behind it come the two numbers that say whether it is time to rest: `streak 2h46`, how long you have gone without a pause of ten minutes, and `day 9h15`, the day's active time, counted in five-minute slots in which any session had an event. Both are grey while they are ordinary and turn yellow and then red once they are not (the streak at one and two hours, the day at six and eight), so the line does not shout in green all day; each is left out while it is zero. An hour with no activity yet prints `load -`. When the file's `asOf` is older than five minutes, or the file is missing or fails validation, pult starts `zapara status` in the background (the `zapara` on your `PATH` or beside your `bun`, else `bun x @drakulavich/zapara status`), does not wait for it, and prints the last value it has, dimmed, or nothing. The next render, thirty seconds later, reads the fresh file. A zapara that is missing or broken costs one background start every five minutes and an empty segment, never an error in the line: a marker file in your temp directory is what keeps it to one start per interval.

The file is validated field by field before anything is printed, and a file that does not pass is treated as no data. The file format and this refresh contract are documented in zapara's spec, `docs/superpowers/specs/2026-09-19-zapara-status-file-design.md`.

## When something is wrong

The status line is a bad place to fail. Claude Code prints whatever the command writes, every line of it, as its own row, so pult treats the payload as hostile:

- Malformed or empty JSON prints `statusline: no payload` and exits 0.
- Every field is parsed once, at the boundary. A `number` that arrives as a string, `null` or `NaN` drops its section rather than rendering `NaN`; a percentage over 100 is capped; a negative cost, count or percentage is dropped, since none of them can be one.
- `fast_mode` has to be the boolean `true`. JSON carries the word, and `"false"` is a non-empty string.
- Control characters are stripped from every name that gets printed, so a branch or directory named with an escape sequence cannot repaint your terminal or push the line onto a second row.
- `git` missing from `PATH` costs you the branch, not the line. The status line runs outside your shell profile, where `PATH` is whatever it is. A `git` older than 2.31 (2021) costs you the repository name, and only when the payload leaves it out: the `rev-parse` behind that one fact asks for absolute paths, which older versions do not offer. The branch comes from `status` and is unaffected.
- Run by hand with nothing piped in, it tells you how to feed it instead of waiting forever.

## Tests

```sh
bun test                          # whole suite
bun test -t "survives an empty"   # one test by name
bun install && bun run typecheck  # the other gate CI runs
```

The tests spawn the real script and strip ANSI before asserting, so they read the way your line does. They cover the wrapper too, since that is the part `settings.json` actually names.

The typecheck is the other half: the payload is parsed once into a `Session` whose fields are what they claim, so assigning a raw payload value to one does not compile. Types catch the numbers, tests catch the strings.

## License

Made with ❤️ and 🥤 energy under [MIT License](LICENSE)
