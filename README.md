# pult

A one-line status line for Claude Code. Reads the session JSON Claude Code pipes to a `statusLine` command and prints one line: model, context usage, cost and duration, lines changed, rate limits with time to reset, repo and branch, worktree, pull request. No dependencies beyond Bun; ~35 ms per render.

```
Fable 5.1 │ ctx 41% 414k/1.0M │ $4.21 · 1h30 │ +156/-23 │ 5h 24% ↻2h09 · 7d 81% ↻83h19 │ kesha-voice-kit:main │ PR #1150 pending
```

Context and rate-limit percentages turn yellow at 50% and red at 80%. A `*` after the branch means the tree has uncommitted tracked changes.

## Install

```sh
git clone git@github.com:drakulavich/pult.git ~/Personal/repos/pult
```

Then in `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "/Users/anton/.bun/bin/bun /Users/anton/Personal/repos/pult/pult.ts",
  "refreshInterval": 30
}
```

Absolute paths on purpose: the status line runs outside any shell profile, so `bun` may not be on `PATH`.

## Payload

The fields are the ones documented at <https://code.claude.com/docs/en/statusline>. Anything absent from the payload is left out of the line rather than rendered as a placeholder. Try it by hand:

```sh
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":12,"context_window_size":200000}}' | bun pult.ts
```

## Test

```sh
bun test
```
