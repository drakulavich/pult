# pult

A one-line status line for Claude Code. Reads the session JSON Claude Code pipes to a `statusLine` command and prints one line: model, context usage, cost and duration, lines changed, rate limits with time to reset, repo and branch, worktree, pull request. No dependencies beyond Bun; ~35 ms per render.

```
Fable 5.1 │ ctx 41% 414k/1.0M │ $4.21 · 1h30 │ +156/-23 │ 5h 24% ↻2h09 · 7d 81% ↻83h19 │ kesha-voice-kit:main │ PR #1150 pending
```

Context and rate-limit percentages turn yellow at 50% and red at 80%. A `*` after the branch means the tree has uncommitted tracked changes.

## Install

Bun is the only requirement. Clone the repo wherever you keep things — `~/.claude` is a tidy home for it:

```sh
git clone https://github.com/drakulavich/pult.git ~/.claude/pult
```

Then in `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/pult/pult",
  "refreshInterval": 30
}
```

That is the whole install, for any user on macOS, Linux, or Windows with Git Bash. Claude Code runs the `command` through a shell, so the `~` expands to your home directory; clone somewhere else and the command is just that path instead.

Two things happen inside the `pult` wrapper so that nothing else has to be spelled out:

- It locates `pult.ts` next to itself, following symlinks, so the clone can live anywhere and can be linked onto your `PATH` (`ln -s ~/.claude/pult/pult ~/.local/bin/pult`) if you would rather the command read simply `pult`.
- It looks for `bun` on `PATH`, then in `$BUN_INSTALL/bin`, `~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin` and Linux Homebrew. A status line runs outside your shell profile, so `bun` is often missing from `PATH` even when your terminal finds it fine. If no `bun` turns up, the line reads `statusline: bun not found` instead of going blank.

## Payload

The fields are the ones documented at <https://code.claude.com/docs/en/statusline>. Anything absent from the payload is left out of the line rather than rendered as a placeholder. Try it by hand:

```sh
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":12,"context_window_size":200000}}' | bun pult.ts
```

## Test

```sh
bun test
```
