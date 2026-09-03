# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
bun test                                  # whole suite
bun test -t "survives an empty"           # one test by name
echo '{"model":{"display_name":"Opus"}}' | ./pult   # render a payload by hand
```

There is no build, no lint, and no dependency install — Bun runs `pult.ts` directly.

## Architecture

Two files do the work:

- `pult` — POSIX `sh` wrapper, the entry point named in `settings.json` (as `~/.claude/pult/pult`; Claude Code runs `command` through a shell, so `~` expands). It resolves its own symlink chain to locate `pult.ts` beside it, and falls back to `$BUN_INSTALL/bin`, `~/.bun/bin`, Homebrew and `/usr/local/bin` when `bun` is not on `PATH`. Both exist so no user's absolute paths end up in the install: the clone may live anywhere, and a status line runs outside any shell profile, where `bun` is often absent from `PATH`.
- `pult.ts` — reads the session JSON on stdin, appends each populated section to `parts`, and prints `parts.join(" │ ")`. One pass, top to bottom, no framework.

Constraints that shape the code:

- **Never fail loudly.** Claude Code renders whatever the command prints. A malformed payload or a missing `bun` prints one dim line and exits 0; a nonzero exit or a stack trace would land in the user's status line.
- **Absent means omitted.** Every field of `Payload` is optional and comes from an upstream schema (<https://code.claude.com/docs/en/statusline>) that can gain or drop keys. Missing data drops its whole section rather than rendering a placeholder or a zero.
- **Cheap.** It re-runs every `refreshInterval` seconds. `git()` is the only subprocess; keep it that way.

Color goes through `byLevel`, which is the single place the yellow-at-50 / red-at-80 thresholds live.

Two helpers hold the payload boundary, and new fields should go through them: `num()` accepts only a finite number, because a field typed `number` arrives as whatever the sender put there — JSON `null`, a string, `NaN` serialised to null. `plain()` strips control characters from every name that reaches the terminal, because a directory can be named with an escape sequence or a newline, and the status line renders each printed line as its own row.

## Tests

`tests/pult.test.ts` spawns the real script and strips ANSI before asserting, so tests read as the user's line. The main test pins the full rendered line as one regex — changing field order or separators means updating that regex deliberately.
