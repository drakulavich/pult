#!/usr/bin/env bun
// Claude Code statusLine: reads the session JSON on stdin, prints one line.
// Payload shape: https://code.claude.com/docs/en/statusline

type Payload = {
  cwd?: string;
  model?: { id?: string; display_name?: string };
  workspace?: { current_dir?: string; project_dir?: string; git_worktree?: string; repo?: { name?: string } };
  cost?: { total_cost_usd?: number; total_duration_ms?: number; total_lines_added?: number; total_lines_removed?: number };
  context_window?: { context_window_size?: number; used_percentage?: number; current_usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
  effort?: { level?: string };
  fast_mode?: boolean;
  rate_limits?: { five_hour?: { used_percentage?: number; resets_at?: number }; seven_day?: { used_percentage?: number; resets_at?: number } };
  agent?: { name?: string };
  pr?: { number?: number; review_state?: string };
  worktree?: { name?: string; branch?: string };
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

// A field typed number can arrive as null, a string, or absent; only a real number renders.
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
// Same for a field typed string, and what does render reaches the terminal verbatim,
// so control characters go: a directory may be named with an escape sequence or a newline.
const str = (v: unknown): string | null => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, "") : null);

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
const dur = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}m`;
};
const until = (epoch: number) => dur(Math.max(0, epoch * 1000 - Date.now()));

const git = (cwd: string): string | null => {
  const run = (...a: string[]) => {
    const p = Bun.spawnSync(["git", "-C", cwd, ...a], { stdout: "pipe", stderr: "ignore" });
    return p.exitCode === 0 ? p.stdout.toString().trim() : null;
  };
  const branch = run("rev-parse", "--abbrev-ref", "HEAD");
  if (!branch) return null;
  const dirty = run("status", "--porcelain", "--untracked-files=no");
  return str(branch + (dirty ? "*" : ""));
};

let p: Payload = {};
try {
  const parsed: unknown = JSON.parse(await Bun.stdin.text());
  if (typeof parsed !== "object" || parsed === null) throw new Error("not a payload");
  p = parsed as Payload;
} catch {
  console.log(dim("statusline: no payload"));
  process.exit(0);
}

const parts: string[] = [];

const model = str(p.model?.display_name) ?? str(p.model?.id) ?? "?";
const effort = str(p.effort?.level);
const flags = [p.fast_mode ? "fast" : null, effort && effort !== "high" ? effort : null].filter(Boolean).join(",");
parts.push(bold(cyan(model)) + (flags ? dim(` ${flags}`) : ""));

const cw = p.context_window;
if (cw) {
  const u = cw.current_usage;
  const used = u ? (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) : null;
  const size = num(cw.context_window_size);
  const pct = num(cw.used_percentage) ?? (used && size ? Math.round((100 * used) / size) : 0);
  const suffix = size ? `/${k(size)}` : "";
  parts.push(byLevel(pct, `ctx ${pct}%`) + dim(used !== null ? ` ${k(used)}${suffix}` : suffix));
}

if (p.cost) {
  const c = p.cost;
  const cost = num(c.total_cost_usd);
  const ms = num(c.total_duration_ms);
  const bits = [cost !== null ? `$${cost.toFixed(2)}` : null, ms ? dur(ms) : null].filter(Boolean);
  if (bits.length) parts.push(bits.join(dim(" · ")));
  const added = num(c.total_lines_added) ?? 0;
  const removed = num(c.total_lines_removed) ?? 0;
  if (added || removed) parts.push(green(`+${added}`) + dim("/") + red(`-${removed}`));
}

const rl = p.rate_limits;
if (rl?.five_hour || rl?.seven_day) {
  const seg = (label: string, w?: { used_percentage?: number; resets_at?: number }) => {
    const pct = num(w?.used_percentage);
    if (pct === null) return null;
    const resets = num(w?.resets_at);
    // A reset time is only worth its width once the window is close enough to bite.
    return byLevel(pct, `${label} ${Math.round(pct)}%`) + (resets && pct >= YELLOW ? dim(` ↻${until(resets)}`) : "");
  };
  parts.push([seg("5h", rl.five_hour), seg("7d", rl.seven_day)].filter(Boolean).join(dim(" · ")));
}

const cwd = str(p.workspace?.current_dir) ?? str(p.cwd) ?? process.cwd();
const repo = str(p.workspace?.repo?.name) ?? cwd.split("/").pop() ?? "";
const branch = git(cwd);
const wt = str(p.worktree?.name) ?? str(p.workspace?.git_worktree);
parts.push(dim(repo) + (branch ? dim(":") + branch : "") + (wt ? dim(` (wt ${wt})`) : ""));

const prNumber = num(p.pr?.number);
if (prNumber) {
  const state = str(p.pr?.review_state);
  parts.push(`PR #${prNumber}` + (state ? dim(` ${state}`) : ""));
}
const agent = str(p.agent?.name);
if (agent) parts.push(dim(`agent ${agent}`));

console.log(parts.join(dim(" │ ")));
