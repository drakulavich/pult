#!/usr/bin/env bun
// Claude Code statusLine. Payload shape: https://code.claude.com/docs/en/statusline
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Already checked: an unusable field is null here, never a string where a number belongs.
type Session = {
  model: string;
  flags: string[];
  context: { pct: number; size: number | null } | null;
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
  return { pct: percent(v.used_percentage) ?? Math.round(computed), size };
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

// One decimal, unless it is a zero: 1.2M and 1M, never 1.0M.
const tenth = (n: number) => n.toFixed(1).replace(/\.0$/, "");
// Both judge the number they would print, not the one they were given: 999_950 would
// print as 1000.0k and is a million, 999.995 as a thousand dollars and is $1k.
const k = (n: number) => {
  if (Number(tenth(n / 1000)) >= 1000) return `${tenth(n / 1_000_000)}M`;
  if (n >= 1000) return `${tenth(n / 1000)}k`;
  return `${n}`;
};
// Each unit up drops the one two below: hours lose seconds, days lose minutes.
const dur = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d${h % 24}h`;
  return h ? `${h}h${String(m % 60).padStart(2, "0")}` : `${m}m`;
};
// Cents matter under a thousand dollars; over it the tenth does.
const usd = (n: number) => (Number(n.toFixed(2)) >= 1000 ? `$${tenth(n / 1000)}k` : `$${n.toFixed(2)}`);
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

// Today's load from zapara (https://github.com/drakulavich/zapara), read from the file
// `zapara status` writes: one line of JSON, nine fields, documented in its spec at
// docs/superpowers/specs/2026-09-19-zapara-status-file-design.md. Opt-in with --zapara,
// because keeping the file fresh means starting zapara, which not every pult user has.
type Load = { index: number | null; level: string | null; streakMin: number; activeMin: number; asOf: number };
const LEVELS = ["Calm", "Warming", "Heating", "Fried"];
// The file is stale, and zapara is started, once asOf is this old; and zapara is started
// at most once per this interval however stale the file stays.
const LOAD_STALE_MS = 5 * 60_000;
const loadFile = (home: string) => join(home, ".claude", "zapara", "status.json");
const int = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

// Strict on every field, not just the ones printed: a file that fails here is no data,
// whoever wrote it, and the reader never guesses at a field that arrived wrong.
const decodeLoad = (raw: unknown, now: number): Load | null => {
  const s = obj(raw);
  const asOf = typeof s.asOf === "string" ? Date.parse(s.asOf) : NaN;
  const index = s.index === null ? null : int(s.index, 100);
  const level = s.level === null ? null : typeof s.level === "string" && LEVELS.includes(s.level) ? s.level : undefined;
  // A day has 1440 minutes, and both count minutes of this day; 1e308 is an integer too.
  const streakMin = int(s.streakMin, 1440);
  const activeMin = int(s.activeMin, 1440);
  const ok =
    s.schema === 1 &&
    Number.isFinite(asOf) &&
    asOf <= now + 60_000 &&
    typeof s.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
    // A real calendar day: 2026-02-31 parses, as March 3rd, and does not round-trip.
    new Date(`${s.date}T00:00:00Z`).toISOString().slice(0, 10) === s.date &&
    int(s.hour, 23) !== null &&
    (index === null) === (s.index === null) &&
    level !== undefined &&
    (level === null) === (index === null) &&
    (s.peak === null || int(s.peak, 100) !== null) &&
    activeMin !== null &&
    streakMin !== null;
  return ok ? { index, level, streakMin: streakMin ?? 0, activeMin: activeMin ?? 0, asOf } : null;
};

const readLoad = (home: string, now: number): Load | null => {
  try {
    return decodeLoad(JSON.parse(readFileSync(loadFile(home), "utf8")), now);
  } catch {
    return null;
  }
};

// The one subprocess that is not git, and the only one the line does not wait for:
// zapara scans every transcript, which is why it writes a file instead of being run each
// render. It is started through `sh … &`, which forks it and exits at once, so this
// process waits a few milliseconds for the shell and never for zapara, and zapara is
// reparented to init with no handle left in this process: Bun.spawn with `detached` and
// `unref()` was tried first, and a child started that way died when this process exited
// before the child had finished starting. A marker in the temp dir is the single flight: a
// zapara that is missing, broken or slow costs one start per interval, never one per
// render. When the marker cannot be written there is no throttle, so nothing is started.
//
// Two renders can overlap (two Claude Code sessions share the temp dir, and a render is
// killed rather than waited for when the next one is due), so the marker is claimed, not
// checked and then written. A missing marker is created exclusively, and one create wins.
// An expired marker is renamed away first, and one rename wins; the winner then creates
// the new marker exclusively too, and if another render slipped its own in between, that
// render is the one starting zapara, so this one does not.
const claimStart = (marker: string, now: number): boolean => {
  const create = (): boolean => {
    try {
      closeSync(openSync(marker, "wx"));
      return true;
    } catch {
      return false;
    }
  };
  let mtime: number;
  try {
    mtime = statSync(marker).mtimeMs;
  } catch {
    return create();
  }
  if (now - mtime < LOAD_STALE_MS) return false;
  const claimed = `${marker}.${process.pid}`;
  try {
    renameSync(marker, claimed);
  } catch {
    return false;
  }
  try {
    unlinkSync(claimed);
  } catch {}
  return create();
};

const refreshLoad = (home: string, now: number): void => {
  if (!claimStart(join(tmpdir(), `pult-zapara-${process.getuid?.() ?? 0}`), now)) return;
  // A status line runs outside any shell profile, so PATH may lack the bun that is
  // running this script, and a globally installed zapara lives beside that bun.
  const zapara = Bun.which("zapara", { PATH: `${process.env.PATH ?? ""}:${dirname(process.execPath)}` });
  const cmd = zapara ? [zapara, "status"] : [process.execPath, "x", "@drakulavich/zapara", "status"];
  try {
    Bun.spawnSync(["sh", "-c", '"$0" "$@" </dev/null >/dev/null 2>&1 &', ...cmd], { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: { ...process.env, HOME: home } });
  } catch {
    // spawnSync throws rather than exiting non-zero when sh is not on PATH.
  }
};

// The segment answers "time to rest?": how hot this hour is, how long since a break,
// how much of the day is spent. The level is zapara's word for the index, so the colour
// follows it and the thresholds stay in one place, there. The streak (no pause of ten
// minutes) and the day's active time are dim until they matter, then yellow and red, so
// the line does not shout in green all day; each is left out while it is zero. A stale
// value is still the last thing known, all of it dimmed.
const STREAK_YELLOW = 60;
const STREAK_RED = 120;
const DAY_YELLOW = 6 * 60;
const DAY_RED = 8 * 60;
const loadSeg = (l: Load, fresh: boolean): string => {
  const text = `load ${l.index ?? "-"}`;
  const once = (min: number, at: [number, number], s: string) => (!fresh ? dim(s) : min >= at[1] ? red(s) : min >= at[0] ? yellow(s) : dim(s));
  const bits = [
    !fresh ? dim(text) : l.level === "Fried" ? bold(red(text)) : l.level === "Heating" ? red(text) : l.level === "Warming" ? yellow(text) : l.level === "Calm" ? green(text) : dim(text),
    l.streakMin ? once(l.streakMin, [STREAK_YELLOW, STREAK_RED], `streak ${dur(l.streakMin * 60_000)}`) : null,
    l.activeMin ? once(l.activeMin, [DAY_YELLOW, DAY_RED], `day ${dur(l.activeMin * 60_000)}`) : null,
  ].filter((b) => b !== null);
  return bits.join(dim(" · "));
};

if (process.stdin.isTTY || Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
  console.log(dim(`pult reads the Claude Code session JSON on stdin. Try: echo '{"model":{"display_name":"Opus"}}' | pult. Add --zapara for today's load.`));
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

// The window size is what the percentage is of, and the difference between a 200k and
// a 1M session. The token count is their product and is not printed.
if (s.context) parts.push(byLevel(s.context.pct, `ctx ${s.context.pct}%`) + (s.context.size ? dim(` of ${k(s.context.size)}`) : ""));

if (s.cost) {
  const bits = [s.cost.usd !== null ? usd(s.cost.usd) : null, s.cost.ms ? dur(s.cost.ms) : null].filter((b) => b !== null);
  parts.push(bits.join(dim(" · ")));
}

if (s.lines) parts.push(green(`+${k(s.lines.added)}`) + dim("/") + red(`-${k(s.lines.removed)}`));

if (s.limits.length) {
  // A reset time is only worth its width once the window is close enough to bite.
  const seg = (w: Session["limits"][number]) => byLevel(w.pct, `${w.label} ${w.pct}%`) + (w.resets && w.pct >= YELLOW ? dim(` ↻${until(w.resets)}`) : "");
  parts.push(s.limits.map(seg).join(dim(" · ")));
}

if (Bun.argv.includes("--zapara")) {
  const now = Date.now();
  const home = process.env.HOME || homedir();
  const load = readLoad(home, now);
  const fresh = load !== null && now - load.asOf < LOAD_STALE_MS;
  if (load) parts.push(loadSeg(load, fresh));
  if (!fresh) refreshLoad(home, now);
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

// pending is every open PR nobody has looked at yet: true almost always, and eight
// columns to say so. The other three each ask for something, so they keep their width
// and take a colour from what they ask for. An undocumented state is still news.
const prState = (state: string) => (state === "approved" ? green(state) : state === "changes_requested" ? red(state) : dim(state));
if (s.pr) parts.push(`PR #${s.pr.number}` + (s.pr.state && s.pr.state !== "pending" ? ` ${prState(s.pr.state)}` : ""));
if (s.agent) parts.push(dim(`agent ${s.agent}`));

console.log(parts.join(dim(" │ ")));

export {};
