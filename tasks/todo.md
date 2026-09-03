# Codex CLI Compatibility Tasks

- [x] Task 1: Correct the Codex configuration contract in `SPEC-codex-cli.md`.
  - Acceptance: `tui.status_line` is documented as built-in configuration, not an external command; the official source is linked.
  - Verify: `rg -n 'tui.status_line|status_line.command|/statusline' SPEC-codex-cli.md`

- [x] Task 2: Add the Codex CLI guide, field mapping, and requested `AGENTS.md` instruction.
  - Acceptance: the `/statusline` setup, native limits, Pult non-goals, and the exact project instruction are explicit.
  - Verify: `rg -n 'Codex CLI|/statusline|tui\.status_line' README.md && sed -n '1p' AGENTS.md`

- [ ] Task 3: Verify docs-only scope and existing Claude Code behavior.
  - Acceptance: all Pult tests pass; no renderer, dependency, or user config changes.
  - Verify: `git diff --check && bun test`
