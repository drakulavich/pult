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
Fable 5.1 │ ctx 41% 414k/1.0M │ $4.21 · 1h30 │ +156/-23 │ 5h 24% · 7d 81% ↻83h19 │ kesha-voice-kit:main │ PR #1150 pending
```

- **Everything on one row** — nothing wraps, nothing scrolls, and sections you have no data for are simply absent
- **Colored where it counts** — context and rate-limit percentages go yellow at 50% and red at 80%; a `*` after the branch means uncommitted tracked changes
- **Two files, no dependencies** — a POSIX `sh` wrapper and one TypeScript file that Bun runs directly. No build, no install step, no `node_modules`
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

Claude Code reads that at startup, so the line appears in your next session. It runs the command through a shell, which is why the `~` expands; if you cloned somewhere else, the command is just that path instead.

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
| `ctx 41% 414k/1.0M` | `context_window` | Uses `used_percentage` when the payload has it, otherwise adds up `current_usage` against the window size |
| `$4.21 · 1h30` | `cost.total_cost_usd`, `total_duration_ms` | |
| `+156/-23` | `cost.total_lines_added`, `total_lines_removed` | Hidden when both are zero |
| `5h 24% · 7d 81% ↻83h19` | `rate_limits.five_hour`, `seven_day` | The `↻` reset time appears once a window has gone yellow, so a quiet session shows percentages alone |
| `pult:main*` | `workspace.repo.name`, then git | Repo name, or the last segment of the working directory. The branch comes from `git` in that directory, so it is empty outside a repo |
| `(wt review)` | `worktree.name`, `workspace.git_worktree` | |
| `PR #1150 pending` | `pr.number`, `pr.review_state` | |
| `agent explorer` | `agent.name` | |

Absent data drops its section rather than rendering a zero or a placeholder, so the line stays short in a fresh session and grows as the session does.

## When something is wrong

The status line is a bad place to fail. Claude Code prints whatever the command writes, every line of it, as its own row, so pult treats the payload as hostile:

- Malformed or empty JSON prints `statusline: no payload` and exits 0.
- A field typed `number` that arrives as a string, `null` or `NaN` drops its section instead of rendering `NaN`.
- Control characters are stripped from every name that gets printed, so a branch or directory named with an escape sequence cannot repaint your terminal or push the line onto a second row.

## Tests

```sh
bun test                          # whole suite
bun test -t "survives an empty"   # one test by name
```

The tests spawn the real script and strip ANSI before asserting, so they read the way your line does. They cover the wrapper too, since that is the part `settings.json` actually names.

## License

Made with ❤️ and 🥤 energy under [MIT License](LICENSE)
