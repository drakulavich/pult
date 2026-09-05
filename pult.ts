#!/usr/bin/env bun
// Claude Code statusLine. Payload shape: https://code.claude.com/docs/en/statusline

// Already checked: an unusable field is null here, never a string where a number belongs.
type Session = {
  model: string;
  flags: string[];
  context: { pct: number; used: number | null; size: number | null } | null;
  cost: { usd: number | null; ms: number | null } | null;
  lines: { added: number; removed: number } | null;
  limits: { label: string; pct: number; resets: number | null }[];
  cwd: string;
  repo: string | null;
  worktree: string | null;
  pr: { number: number; state: string | null } | null;
  agent: string | null;
};

// The boundary: the payload promises types it does not keep, so a `number` arrives as
// null, a string or NaN. Negative goes too -- every number here is a count, a cost or
// an epoch, and "-5" once rendered as "+-5" in green.
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
// Capped because senders send 250, rounded because the printed number is the one the
// colour and the reset time are judged by.
const percent = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(Math.min(100, n));
};
// Control characters go: each printed line becomes its own row, and a directory can be
// named with an escape sequence or a newline.
const str = (v: unknown): string | null => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, "") : null);
// JSON carries the word: "false" is a non-empty string, and those are all truthy.
const bool = (v: unknown): boolean => v === true;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});

const parse = (raw: unknown): Session => {
  const p = obj(raw);
  const model = obj(p.model);
  const workspace = obj(p.workspace);
  const limits = obj(p.rate_limits);
  const effort = str(obj(p.effort).level);

  const cwd = str(workspace.current_dir) ?? str(p.cwd) ?? process.cwd();

  const window = (label: string, v: unknown) => {
    const w = obj(v);
    const pct = percent(w.used_percentage);
    return pct === null ? null : { label, pct, resets: num(w.resets_at) };
  };

  return {
    model: str(model.display_name) ?? str(model.id) ?? "?",
    flags: [bool(p.fast_mode) ? "fast" : null, effort && effort !== "high" ? effort : null].filter((f) => f !== null),
    context: parseContext(p.context_window),
    cost: parseCost(p.cost),
    lines: parseLines(p.cost),
    limits: [window("5h", limits.five_hour), window("7d", limits.seven_day)].filter((w) => w !== null),
    cwd,
    repo: str(obj(workspace.repo).name) || null,
    // Both are names, not paths: worktree.path carries the path and nothing reads it.
    // || not ??, because an empty name is a string and would swallow the fallback.
    worktree: str(obj(p.worktree).name) || str(workspace.git_worktree) || null,
    pr: parsePr(p.pr),
    agent: str(obj(p.agent).name),
  };
};

const parseContext = (v: unknown): Session["context"] => {
  if (!isObj(v)) return null;
  const usage = v.current_usage;
  const used = isObj(usage)
    ? (num(usage.input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0) + (num(usage.cache_read_input_tokens) ?? 0)
    : null;
  const size = num(v.context_window_size);
  const computed = used && size ? Math.min(100, (100 * used) / size) : 0;
  return { pct: percent(v.used_percentage) ?? Math.round(computed), used, size };
};

const parseCost = (v: unknown): Session["cost"] => {
  if (!isObj(v)) return null;
  const usd = num(v.total_cost_usd);
  const ms = num(v.total_duration_ms);
  return usd === null && !ms ? null : { usd, ms };
};

const parseLines = (v: unknown): Session["lines"] => {
  const cost = obj(v);
  const added = num(cost.total_lines_added) ?? 0;
  const removed = num(cost.total_lines_removed) ?? 0;
  return added || removed ? { added, removed } : null;
};

const parsePr = (v: unknown): Session["pr"] => {
  const pr = obj(v);
  const number = num(pr.number);
  return number ? { number, state: str(pr.review_state) } : null;
};

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = 50;
const RED = 80;
const byLevel = (pct: number, s: string) => (pct >= RED ? red(s) : pct >= YELLOW ? yellow(s) : green(s));

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
const dur = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}m`;
};
const until = (epoch: number) => dur(Math.max(0, epoch * 1000 - Date.now()));

// A linked worktree reports the main repository's .git, so the repository is the
// directory holding it -- except a bare repo, which is the directory itself.
const repoName = (common: string | null): string | null => {
  const parts = (common ?? "").split("/").filter((p) => p !== "");
  const last = parts.pop();
  if (!last) return null;
  return str(last === ".git" ? (parts.pop() ?? null) : last.replace(/\.git$/, "")) || null;
};

// Every subprocess the line runs, and the only place it shells out.
const run = (cwd: string, ...a: string[]): string | null => {
  try {
    const p = Bun.spawnSync(["git", "-C", cwd, ...a], { stdout: "pipe", stderr: "ignore" });
    return p.exitCode === 0 ? p.stdout.toString().trim() : null;
  } catch {
    // spawnSync throws rather than exiting non-zero when git is not on PATH.
    return null;
  }
};

// --porcelain=v2 --branch prints "# branch.head <name>" and then a line per change,
// so a line that is not a header means the tree is dirty.
const branch = (cwd: string): string | null => {
  const out = run(cwd, "status", "--porcelain=v2", "--branch", "--untracked-files=no");
  if (out === null) return null;
  const lines = out.split("\n");
  const head = lines.find((l) => l.startsWith("# branch.head "))?.slice(14);
  if (!head) return null;
  const dirty = lines.some((l) => l !== "" && !l.startsWith("#"));
  // git says "(detached)" here and "HEAD" everywhere else.
  return str((head === "(detached)" ? "HEAD" : head) + (dirty ? "*" : ""));
};

// The second call, and the only reason there is one: status cannot report the common
// dir. Its headers are oid, head, upstream and ab.
const repoOf = (cwd: string): string | null => repoName(run(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"));

if (process.stdin.isTTY || Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
  console.log(dim(`pult reads the Claude Code session JSON on stdin. Try: echo '{"model":{"display_name":"Opus"}}' | pult`));
  process.exit(0);
}

let s: Session;
try {
  const raw: unknown = JSON.parse(await Bun.stdin.text());
  if (!isObj(raw)) throw new Error("not a payload");
  s = parse(raw);
} catch {
  console.log(dim("statusline: no payload"));
  process.exit(0);
}

const parts: string[] = [];

parts.push(bold(cyan(s.model)) + (s.flags.length ? dim(` ${s.flags.join(",")}`) : ""));

if (s.context) {
  const suffix = s.context.size ? `/${k(s.context.size)}` : "";
  parts.push(byLevel(s.context.pct, `ctx ${s.context.pct}%`) + dim(s.context.used !== null ? ` ${k(s.context.used)}${suffix}` : suffix));
}

if (s.cost) {
  const bits = [s.cost.usd !== null ? `$${s.cost.usd.toFixed(2)}` : null, s.cost.ms ? dur(s.cost.ms) : null].filter((b) => b !== null);
  parts.push(bits.join(dim(" · ")));
}

if (s.lines) parts.push(green(`+${s.lines.added}`) + dim("/") + red(`-${s.lines.removed}`));

if (s.limits.length) {
  // A reset time is only worth its width once the window is close enough to bite.
  const seg = (w: Session["limits"][number]) => byLevel(w.pct, `${w.label} ${w.pct}%`) + (w.resets && w.pct >= YELLOW ? dim(` ↻${until(w.resets)}`) : "");
  parts.push(s.limits.map(seg).join(dim(" · ")));
}

const head = branch(s.cwd);

// A function, not a value: the ?? below decides whether this subprocess runs at all.
// rev-parse only works where status already found a work tree.
const fromGit = () => (head !== null ? repoOf(s.cwd) : null);

// Best first. The directory is the worktree's name inside a worktree, not the repo's.
const repo = s.repo ?? fromGit() ?? s.cwd.split("/").pop() ?? "";

// All three can be empty at once (/, or a name that was only control characters), so
// the separators join names that exist rather than decorating one that does not.
const where = [repo ? dim(repo) : null, head].filter((n) => n !== null).join(dim(":"));
// A worktree is normally named after its branch, and git keeps a branch in one worktree
// at a time, so repeating the name says nothing the branch has not. The dirty marker comes
// off before comparing, which cannot hide a branch because git forbids "*" in a ref name.
const named = s.worktree === head?.replace(/\*$/, "");
const wt = s.worktree ? dim(named ? "(wt)" : `(wt ${s.worktree})`) : null;
const place = [where || null, wt].filter((n) => n !== null).join(" ");
if (place) parts.push(place);

if (s.pr) parts.push(`PR #${s.pr.number}` + (s.pr.state ? dim(` ${s.pr.state}`) : ""));
if (s.agent) parts.push(dim(`agent ${s.agent}`));

console.log(parts.join(dim(" │ ")));

export {};
