# CLAUDE.md

Every line below traces to a mistake someone actually made here. If something in
this project surprises or confuses you, say so in your reply rather than coding
around it: that is how a line earns its place, or how the code earns a fix.

- **Never fail loudly.** Claude Code renders whatever the command prints, so a
  malformed payload or a missing `bun` prints one dim line and exits 0. This has
  been broken twice: a non-string `display_name` threw out of `plain()`, and a
  non-string `cwd` threw out of `cwd.split()`. Both printed a stack trace where
  the status line goes.
- **The payload is parsed once, into `Session`.** `parse()` is the only place
  that touches the raw JSON, and `num()` and `str()` are the only way through it:
  the type says what the sender promised, not what arrives, so a `number` shows up
  as JSON null or a string. Below `parse()` the types are facts and the renderer
  reads them directly. Assigning a raw field to `Session` does not compile, which
  is what stops the two crashes above coming back. A field that arrived unusable
  is null, and its section is dropped rather than rendering a zero, a placeholder,
  or `NaN`.
- **One subprocess.** The line re-renders every `refreshInterval` seconds and
  `git()` is the only thing it shells out to. Wanting a second git fact means
  adding arguments to that one `rev-parse`, not a second call (see #3).
- **The main test pins the whole rendered line as one regex.** When it fails,
  decide whether the new line is right and update the regex deliberately. It is
  not flake, and it is the only thing watching the output as a whole.

Bun runs `pult.ts` directly: no build, and nothing to install to run it or to
run the tests. The one devDependency is `tsc`, which `bun run typecheck` and CI
use to hold the rule above.
