# CLAUDE.md

Every line below traces to a mistake someone actually made here. If something in
this project surprises or confuses you, say so in your reply rather than coding
around it: that is how a line earns its place, or how the code earns a fix.

- **Never fail loudly.** Claude Code renders whatever the command prints, so a
  malformed payload or a missing `bun` prints one dim line and exits 0. This has
  been broken twice: a non-string `display_name` threw out of `plain()`, and a
  non-string `cwd` threw out of `cwd.split()`. Both printed a stack trace where
  the status line goes.
- **Every payload field goes through `num()` or `str()`.** The type says what the
  sender promised, not what arrives; a `number` shows up as JSON null or a string.
  Reading `p.cost.total_cost_usd` directly is the bug those two exist to prevent.
  A field that is absent or unusable drops its whole section rather than
  rendering a zero, a placeholder, or `NaN`.
- **One subprocess.** The line re-renders every `refreshInterval` seconds and
  `git()` is the only thing it shells out to. Wanting a second git fact means
  adding arguments to that one `rev-parse`, not a second call (see #3).
- **The main test pins the whole rendered line as one regex.** When it fails,
  decide whether the new line is right and update the regex deliberately. It is
  not flake, and it is the only thing watching the output as a whole.

There is no build, no lint, and no dependency install; Bun runs `pult.ts`
directly.
