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
const byLevel = (pct: number, s: string) => (pct >= 80 ? red(s) : pct >= 50 ? yellow(s) : green(s));

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
  return branch + (dirty ? "*" : "");
};

let p: Payload = {};
try {
  p = JSON.parse(await Bun.stdin.text());
} catch {
  console.log(dim("statusline: no payload"));
  process.exit(0);
}

const parts: string[] = [];

const model = p.model?.display_name ?? p.model?.id ?? "?";
const flags = [p.fast_mode ? "fast" : null, p.effort?.level && p.effort.level !== "high" ? p.effort.level : null].filter(Boolean).join(",");
parts.push(bold(cyan(model)) + (flags ? dim(` ${flags}`) : ""));

const cw = p.context_window;
if (cw) {
  const u = cw.current_usage;
  const used = u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : null;
  const pct = cw.used_percentage ?? (used && cw.context_window_size ? Math.round((100 * used) / cw.context_window_size) : 0);
  const size = cw.context_window_size ? `/${k(cw.context_window_size)}` : "";
  parts.push(byLevel(pct, `ctx ${pct}%`) + dim(used !== null ? ` ${k(used)}${size}` : size));
}

if (p.cost) {
  const c = p.cost;
  const bits = [c.total_cost_usd !== undefined ? `$${c.total_cost_usd.toFixed(2)}` : null, c.total_duration_ms ? dur(c.total_duration_ms) : null].filter(Boolean);
  if (bits.length) parts.push(bits.join(dim(" · ")));
  if (c.total_lines_added || c.total_lines_removed) parts.push(green(`+${c.total_lines_added ?? 0}`) + dim("/") + red(`-${c.total_lines_removed ?? 0}`));
}

const rl = p.rate_limits;
if (rl?.five_hour || rl?.seven_day) {
  const seg = (label: string, w?: { used_percentage?: number; resets_at?: number }) =>
    w?.used_percentage === undefined ? null : byLevel(w.used_percentage, `${label} ${Math.round(w.used_percentage)}%`) + (w.resets_at ? dim(` ↻${until(w.resets_at)}`) : "");
  parts.push([seg("5h", rl.five_hour), seg("7d", rl.seven_day)].filter(Boolean).join(dim(" · ")));
}

const cwd = p.workspace?.current_dir ?? p.cwd ?? process.cwd();
const repo = p.workspace?.repo?.name ?? cwd.split("/").pop() ?? "";
const branch = git(cwd);
const wt = p.worktree?.name ?? p.workspace?.git_worktree;
parts.push(dim(repo) + (branch ? dim(":") + branch : "") + (wt ? dim(` (wt ${wt})`) : ""));

if (p.pr?.number) parts.push(`PR #${p.pr.number}` + (p.pr.review_state ? dim(` ${p.pr.review_state}`) : ""));
if (p.agent?.name) parts.push(dim(`agent ${p.agent.name}`));

console.log(parts.join(dim(" │ ")));
