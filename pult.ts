#!/usr/bin/env bun
// Claude Code statusLine: reads the session JSON on stdin, prints one line.
// Payload shape: https://code.claude.com/docs/en/statusline

// What the line renders. Everything here is already checked: a field that
// arrived unusable is null or absent, never a string where a number belongs.
type Session = {
  model: string;
  flags: string[];
  context: { pct: number; used: number | null; size: number | null } | null;
  cost: { usd: number | null; ms: number | null } | null;
  lines: { added: number; removed: number } | null;
  limits: { label: string; pct: number; resets: number | null }[];
  cwd: string;
  repo: string;
  worktree: string | null;
  pr: { number: number; state: string | null } | null;
  agent: string | null;
};

// The boundary. `unknown` stops here: the payload's types say what the sender
// promised, so a `number` arrives as JSON null, a string, or NaN serialised to
// null, and a `string` arrives as a number. Below parse(), types are facts.
// Negative is refused with the rest: a cost, a duration, a count, a percentage
// and an epoch are all >= 0, so "-5" is a sender bug, not data. It used to
// render "+-5" in green.
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
// A percentage over 100 says the sender is confused, not that the window is
// 250% full. Cap it: the line still reads red, and never prints "5h 250%".
const percent = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.min(100, n);
};
// A name reaches the terminal verbatim and the status line renders each printed
// line as its own row, so control characters go: a directory can be named with
// an escape sequence or a newline.
const str = (v: unknown): string | null => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, "") : null);
// A flag is on only when it arrived as the boolean true. JSON carries the word,
// and every non-empty string is truthy, so "false" used to read as fast.
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
    return pct === null ? null : { label, pct: Math.round(pct), resets: num(w.resets_at) };
  };

  return {
    model: str(model.display_name) ?? str(model.id) ?? "?",
    flags: [bool(p.fast_mode) ? "fast" : null, effort && effort !== "high" ? effort : null].filter((f) => f !== null),
    context: parseContext(p.context_window),
    cost: parseCost(p.cost),
    lines: parseLines(p.cost),
    limits: [window("5h", limits.five_hour), window("7d", limits.seven_day)].filter((w) => w !== null),
    cwd,
    repo: str(obj(workspace.repo).name) ?? cwd.split("/").pop() ?? "",
    worktree: str(obj(p.worktree).name) ?? str(workspace.git_worktree),
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
  const computed = used && size ? Math.min(100, Math.round((100 * used) / size)) : 0;
  return { pct: percent(v.used_percentage) ?? computed, used, size };
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
// The two thresholds the whole line reads from: what turns yellow, and what turns red.
const YELLOW = 50;
const RED = 80;
const byLevel = (pct: number, s: string) => (pct >= RED ? red(s) : pct >= YELLOW ? yellow(s) : green(s));

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
const dur = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}m`;
};
const until = (epoch: number) => dur(Math.max(0, epoch * 1000 - Date.now()));

const git = (cwd: string): string | null => {
  const run = (...a: string[]) => {
    try {
      const p = Bun.spawnSync(["git", "-C", cwd, ...a], { stdout: "pipe", stderr: "ignore" });
      return p.exitCode === 0 ? p.stdout.toString().trim() : null;
    } catch {
      // No git on PATH. The branch is optional; the line goes on without it.
      return null;
    }
  };
  const branch = run("rev-parse", "--abbrev-ref", "HEAD");
  if (!branch) return null;
  const dirty = run("status", "--porcelain", "--untracked-files=no");
  return str(branch + (dirty ? "*" : ""));
};

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

const branch = git(s.cwd);
parts.push(dim(s.repo) + (branch ? dim(":") + branch : "") + (s.worktree ? dim(` (wt ${s.worktree})`) : ""));

if (s.pr) parts.push(`PR #${s.pr.number}` + (s.pr.state ? dim(` ${s.pr.state}`) : ""));
if (s.agent) parts.push(dim(`agent ${s.agent}`));

console.log(parts.join(dim(" │ ")));

export {};
