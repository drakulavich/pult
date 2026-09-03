# Codex CLI Compatibility Implementation Plan

**Goal:** Document a supported Codex-native status-line path without adding a Pult renderer to Codex.

**Architecture:** Codex's documented `tui.status_line` is a list of Codex-provided footer items, not a command callback. Keep Pult's Claude Code wrapper and renderer unchanged; publish a README guide that uses `/statusline`.

## Ordered Work

1. Correct the compatibility spec using the official configuration contract.
2. Add the README's native setup flow, field mapping, and explicit non-goals;
   add the requested one-line `AGENTS.md` instruction.
3. Verify docs-only scope and run the complete Bun suite.

## Risks

- Codex can change supported footer identifiers. Mitigation: direct users to `/statusline`; do not hard-code identifiers.
- Account entitlement affects cost and usage. Mitigation: label both as availability-dependent.
- Users may assume Pult renders Codex. Mitigation: state the boundary first.
