# Spec: Codex CLI Compatibility

## Status

Proposed — this document defines the supported Codex CLI experience before implementation.

## Objective

Give Pult users a reliable Codex CLI status-line setup without claiming that Pult renders Codex's footer. Pult remains a Claude Code renderer: Claude sends it session JSON on stdin. Codex owns and renders its own TUI footer.

## Codex Configuration Contract

The [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents `tui.status_line` as an ordered list of Codex's footer item identifiers; `null` disables that footer. The setting is not an executable, plugin entry point, or session-JSON payload hook. Consequently, `status_line.command`, `statusLine.command`, and every equivalent external renderer setting are unsupported.

Users should configure the native footer through `/statusline` in an interactive Codex session. That selector is preferred over Pult hard-coding identifiers, because Codex owns their availability and meaning. Codex persists user-level configuration in `~/.codex/config.toml`, where `tui.status_line` is the documented reference key; Pult must not edit that file.

## User Story

As a Pult user switching from Claude Code to Codex CLI, I can select Codex's native footer items, understand which Pult fields have a native equivalent, and avoid an installation that silently does nothing.

## Tech Stack

- Markdown documentation
- Codex CLI's documented `tui.status_line` configuration
- Existing Bun test suite; no new dependency or runtime code

## Commands

```sh
codex --version
# Inside an interactive Codex session:
/statusline
bun test
```

## Project Structure

```text
pult                POSIX launcher for Claude Code
pult.ts             Claude Code JSON-payload renderer
tests/pult.test.ts  End-to-end tests for the launcher and renderer
README.md           User-facing installation and compatibility guide
spec/SPEC-codex-cli.md  Codex compatibility contract
```

## Code Style

No implementation code is needed for the Codex-native guide. Any later adapter must validate external values, remove terminal control characters, omit unavailable values, and exit zero on malformed input.

```ts
const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
```

## Testing Strategy

- Verify the README maps native and unavailable values correctly.
- Run `bun test`; existing Claude Code behavior must remain unchanged.
- In an isolated Codex profile, use `/statusline`, restart Codex, and check selected native footer items persist.

## Boundaries

- Always: use documented Codex interfaces and state account-dependent fields.
- Ask first: add dependencies, terminal-emulator/tmux integration, or change the existing Claude Code payload/output contract.
- Never: read `~/.codex` session databases or rollouts, scrape the TUI, read credentials, edit the user's `config.toml`, or claim Pult renders the Codex footer.

## Capability Mapping

| Pult / Claude Code value | Codex native equivalent | Notes |
|---|---|---|
| Model and reasoning effort | Model | Native equivalent |
| Context window | Context | Native equivalent |
| Repository and branch | Project / branch summary | Native equivalent when available |
| Pull request | Open PR | Native equivalent when available |
| Changed lines | Committed branch changes | Similar, not the current dirty diff |
| Estimated cost | Estimated thread cost | Enterprise-only and may be unavailable |
| 5-hour / 7-day limits | Usage limits | Account-dependent semantics and availability |
| Agent or worktree name | None | No documented equivalent |

## Success Criteria

1. The README states that Codex's native status line does not invoke Pult.
2. It directs users to `/statusline` and links the configuration reference.
3. It maps native, partial, unavailable, and account-dependent fields.
4. No Pult code or installation step reads private Codex data or modifies `~/.codex/config.toml`.
5. `bun test` passes unchanged.

## Future Trigger

If Codex officially adds an external status-line command and stable input schema, define a Pult `codex` input mode from that published schema with fixture-based tests. Do not infer a contract from local Codex storage.
