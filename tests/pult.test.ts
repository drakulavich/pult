import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const script = resolve(import.meta.dir, "..", "pult.ts");
const wrapper = resolve(import.meta.dir, "..", "pult");

type Env = Record<string, string | undefined>;

async function render(payload: unknown, env?: Env, args: string[] = []): Promise<{ out: string; raw: string; err: string; code: number }> {
  const proc = Bun.spawn([process.execPath, script, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe", ...(env ? { env } : {}) });
  proc.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
  proc.stdin.end();
  const raw = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const out = raw.replace(/\x1b\[[0-9;]*m/g, "");
  return { out, raw, err, code: await proc.exited };
}

describe("pult", () => {
  test("renders every populated section in order", async () => {
    const { out, code } = await render({
      model: { display_name: "Fable 5.1" },
      workspace: { current_dir: "/tmp", repo: { name: "kesha-voice-kit" } },
      cost: { total_cost_usd: 4.2137, total_duration_ms: 5_400_000, total_lines_added: 156, total_lines_removed: 23 },
      context_window: { context_window_size: 1_000_000, used_percentage: 41, current_usage: { input_tokens: 8500, cache_creation_input_tokens: 5000, cache_read_input_tokens: 400_000 } },
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: Math.floor(Date.now() / 1000) + 7800 },
        seven_day: { used_percentage: 81, resets_at: Math.floor(Date.now() / 1000) + 299_970 },
      },
      pr: { number: 1150, review_state: "pending" },
    });
    expect(code).toBe(0);
    expect(out.trim()).toMatch(/^Fable 5\.1 │ ctx 41% of 1M │ \$4\.21 · 1h30 │ \+156\/-23 │ 5h 24% · 7d 81% ↻3d11h │ kesha-voice-kit(:\S+)? │ PR #1150$/);
  });

  test("leaves absent sections out instead of printing placeholders", async () => {
    const { out } = await render({ model: { display_name: "Opus" }, workspace: { current_dir: "/tmp" } });
    expect(out).toContain("Opus");
    expect(out).not.toMatch(/ctx|\$|5h|7d|PR #|undefined|NaN/);
  });

  test("survives an empty or malformed payload", async () => {
    for (const bad of ["", "not json"]) {
      const { out, code } = await render(bad);
      expect(code).toBe(0);
      expect(out).toContain("no payload");
    }
  });

  // "Optional" in the upstream type is not a guarantee of type at runtime.
  test("drops a cost that is not a number instead of crashing", async () => {
    for (const total_cost_usd of [null, "4.21"]) {
      const { out, code } = await render({ model: { display_name: "Opus" }, cost: { total_cost_usd } });
      expect(code).toBe(0);
      expect(out).toContain("Opus");
      expect(out).not.toContain("$");
    }
  });

  test("treats a null payload as no payload", async () => {
    const { out, code } = await render("null");
    expect(code).toBe(0);
    expect(out).toContain("no payload");
  });

  test("drops a percentage that is not a number instead of printing NaN", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      rate_limits: { five_hour: { used_percentage: "x" } },
      context_window: { used_percentage: "y", context_window_size: 200_000 },
    });
    expect(code).toBe(0);
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("5h");
  });

  test("strips control characters out of the names it renders", async () => {
    const { raw, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: "/tmp", repo: { name: "\x1b[2J\x1b[Hpwned\nsecond row" } },
    });
    expect(code).toBe(0);
    expect(raw.trimEnd().split("\n")).toHaveLength(1);
    expect(raw.replace(/\x1b\[[0-9;]*m/g, "")).not.toContain("\x1b");
  });

  // pending is every open PR nobody has looked at yet, so it is true almost always and
  // costs eight columns to say nothing. The other three each ask for something.
  test("drops a pending review state but keeps the number", async () => {
    const { out, code } = await render({ model: { display_name: "Opus" }, pr: { number: 21, review_state: "pending" } });
    expect(code).toBe(0);
    // The last section, not the whole line: a branch named "...pending..." renders here too.
    expect(out.trim().split(" │ ").at(-1)).toBe("PR #21");
  });

  test("keeps a review state that asks for something", async () => {
    for (const state of ["approved", "changes_requested", "draft"]) {
      const { out, code } = await render({ model: { display_name: "Opus" }, pr: { number: 21, review_state: state } });
      expect(code).toBe(0);
      expect(out).toContain(`PR #21 ${state}`);
    }
  });

  // The documented set can grow, and an unknown state is still news.
  test("keeps a review state it has no colour for", async () => {
    const { out } = await render({ model: { display_name: "Opus" }, pr: { number: 21, review_state: "queued" } });
    expect(out).toContain("PR #21 queued");
  });

  test("survives a name that arrives as something other than a string", async () => {
    const { out, code } = await render({
      model: { display_name: 5, id: 6 },
      cwd: 42,
      workspace: { current_dir: 43, repo: { name: 7 } },
      worktree: { name: 8 },
      agent: { name: 9 },
      pr: { number: "10", review_state: 11 },
    });
    expect(code).toBe(0);
    expect(out).toContain("?");
    expect(out).not.toContain("agent");
    expect(out).not.toContain("PR #");
  });

  test("strips control characters out of every field it renders, not just names", async () => {
    const { out, raw, code } = await render({
      model: { display_name: "Opus" },
      effort: { level: "low\nsecond row" },
      pr: { number: "7\x1b[2J\x1b[Hpwned\nsecond row" },
    });
    expect(code).toBe(0);
    expect(raw.trimEnd().split("\n")).toHaveLength(1);
    expect(out).toContain("lowsecond row");
    expect(out).not.toContain("PR #");
  });

  test("drops usage counts that are not numbers instead of printing NaN", async () => {
    const { out, raw, code } = await render({
      model: { display_name: "Opus" },
      context_window: { current_usage: { input_tokens: "x" }, context_window_size: "y" },
      cost: { total_lines_added: "5\nsecond row" },
    });
    expect(code).toBe(0);
    expect(raw.trimEnd().split("\n")).toHaveLength(1);
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("+");
  });

  // The window size says what the percentage is of; the used count is that product and
  // is not printed. Without a size the percentage stands alone, no "of" trailing it.
  test("names the window the percentage is of, and only when there is one", async () => {
    const sized = await render({ model: { display_name: "Opus" }, context_window: { used_percentage: 9, context_window_size: 200_000 } });
    expect(sized.out).toContain("ctx 9% of 200k │");
    // Rounds up to a thousand thousands, so it is judged as a million: never 1000k.
    const almost = await render({ model: { display_name: "Opus" }, context_window: { used_percentage: 9, context_window_size: 999_999 } });
    expect(almost.out).toContain("ctx 9% of 1M │");
    const unsized = await render({ model: { display_name: "Opus" }, context_window: { used_percentage: 9, current_usage: { input_tokens: 18_000 } } });
    expect(unsized.out).toContain("ctx 9% │");
    expect(unsized.out).not.toContain("18k");
  });

  test("hides the reset time while a rate-limit window is still green", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      rate_limits: { five_hour: { used_percentage: 49, resets_at: Math.floor(Date.now() / 1000) + 7800 } },
    });
    expect(code).toBe(0);
    expect(out).toContain("5h 49%");
    expect(out).not.toContain("↻");
  });

  test("shows the reset time from the moment a window turns yellow", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      rate_limits: { five_hour: { used_percentage: 50, resets_at: Math.floor(Date.now() / 1000) + 7800 } },
    });
    expect(code).toBe(0);
    expect(out).toMatch(/5h 50% ↻2h0\d/);
  });

  test("judges a window by the percentage it prints, not the one behind it", async () => {
    const { out, raw, code } = await render({
      model: { display_name: "Opus" },
      rate_limits: { five_hour: { used_percentage: 49.6, resets_at: Math.floor(Date.now() / 1000) + 7800 } },
    });
    expect(code).toBe(0);
    expect(out).toMatch(/5h 50% ↻2h0\d/);
    expect(raw).toContain("\x1b[33m");
  });

  test("leaves no empty segment when a rate-limit window has no usable percentage", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      rate_limits: { five_hour: { used_percentage: "x" } },
    });
    expect(code).toBe(0);
    // An empty string joined between two separators reads as "Opus │  │ repo".
    expect(out).not.toMatch(/│\s+│/);
  });

  test("treats a fast_mode that is not a boolean as off", async () => {
    for (const fast_mode of ["false", "no", 1, {}, []]) {
      const { out, code } = await render({ model: { display_name: "Opus" }, fast_mode });
      expect(code).toBe(0);
      expect(out).not.toContain("fast");
    }
    const { out } = await render({ model: { display_name: "Opus" }, fast_mode: true });
    expect(out).toContain("fast");
  });

  test("survives git missing from PATH", async () => {
    // spawnSync throws ENOENT rather than exiting non-zero, and a status line runs
    // outside any shell profile.
    const { out, err, code } = await render(
      { model: { display_name: "Opus" }, workspace: { current_dir: "/tmp", repo: { name: "pult" } } },
      { ...process.env, PATH: "/nonexistent" },
    );
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe("Opus │ pult\n");
  });

  test("says how to use it instead of blocking when asked for help", async () => {
    const proc = Bun.spawn([process.execPath, script, "--help"], { stdin: "pipe", stdout: "pipe" });
    proc.stdin.end();
    const out = (await new Response(proc.stdout).text()).replace(/\x1b\[[0-9;]*m/g, "");
    expect(await proc.exited).toBe(0);
    expect(out).toContain("stdin");
  });

  test("drops numbers that are negative, which no field here can be", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      cost: { total_cost_usd: -4.2, total_duration_ms: -90_000, total_lines_added: -5 },
      rate_limits: { five_hour: { used_percentage: -20, resets_at: -1 } },
    });
    expect(code).toBe(0);
    // The whole line is the model and the repo: every negative field was dropped.
    expect(out).not.toContain("$");
    expect(out).not.toContain("5h");
    expect(out).not.toContain("+");
    expect(out).not.toMatch(/-\d/);
  });

  // A session that has run for days is the one whose cost and length are hardest to
  // read at full width, so both shorten once they cross a thousand dollars or a day.
  test("shortens a cost from a thousand dollars and a duration from a day", async () => {
    const cases: [number, number, string][] = [
      [999.994, 86_399_000, "$999.99 · 23h59"],
      // Rounds up to a thousand, so it is judged as one: never $1000.00.
      [999.995, 86_399_000, "$1k · 23h59"],
      [1000, 86_400_000, "$1k · 1d0h"],
      [1005.13, 647_000_000, "$1k · 7d11h"],
      [12_345, 90_000_000, "$12.3k · 1d1h"],
    ];
    for (const [total_cost_usd, total_duration_ms, want] of cases) {
      const { out, code } = await render({ model: { display_name: "Opus" }, cost: { total_cost_usd, total_duration_ms } });
      expect(code).toBe(0);
      expect(out).toContain(want);
    }
  });

  // Thousands to a tenth, like the cost: 2.5k, not 3k. Each side judges itself, and a
  // million is judged by what the k branch would print: 999_950 is 1000.0k, so it is 1M.
  test("counts changed lines in thousands to a tenth from a thousand, each side on its own", async () => {
    const cases: [number, number, string][] = [
      [999, 348, "+999/-348"],
      [156, 2_500, "+156/-2.5k"],
      [11_108, 348, "+11.1k/-348"],
      [999_949, 999_950, "+999.9k/-1M"],
      [1_234_567, 0, "+1.2M/-0"],
    ];
    for (const [total_lines_added, total_lines_removed, want] of cases) {
      const { out, code } = await render({ model: { display_name: "Opus" }, cost: { total_lines_added, total_lines_removed } });
      expect(code).toBe(0);
      expect(out).toContain(want);
    }
  });

  test("counts a reset that is days away in days too", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      rate_limits: { seven_day: { used_percentage: 81, resets_at: Math.floor(Date.now() / 1000) + 6 * 86_400 + 23 * 3600 + 30 * 60 } },
    });
    expect(code).toBe(0);
    expect(out).toContain("7d 81% ↻6d23h");
  });

  test("judges the context window by the percentage it prints, not the one behind it", async () => {
    const { out, raw, code } = await render({
      model: { display_name: "Opus" },
      context_window: { used_percentage: 49.6 },
    });
    expect(code).toBe(0);
    expect(out).toContain("ctx 50%");
    expect(raw).toContain("\x1b[33m");
  });

  test("caps a percentage at 100 rather than printing what it was sent", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      context_window: { used_percentage: 130 },
      rate_limits: { five_hour: { used_percentage: 250, resets_at: Math.floor(Date.now() / 1000) + 7800 } },
    });
    expect(code).toBe(0);
    expect(out).toContain("ctx 100%");
    expect(out).toContain("5h 100%");
    expect(out).not.toContain("130");
    expect(out).not.toContain("250");
  });

  const temps: string[] = [];
  const temp = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    temps.push(dir);
    return dir;
  };
  afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  // Only a worktree makes the repository's name and the directory's differ.
  const worktree = () => {
    const base = temp("pult-git-");
    const root = join(base, "pult-fixture");
    const tree = join(base, "wt-demo");
    mkdirSync(root, { recursive: true });
    const git = (...a: string[]) => Bun.spawnSync(["git", "-C", root, ...a], { stdout: "ignore", stderr: "ignore" });
    git("init", "-q", "-b", "main");
    git("-c", "user.email=pult@example.com", "-c", "user.name=pult", "commit", "-q", "--allow-empty", "-m", "init");
    git("worktree", "add", "-q", tree, "-b", "wt-demo");
    return tree;
  };

  // A git that logs itself before handing over, so the count is a fact not a claim.
  const spawns = async (payload: unknown): Promise<string[]> => {
    const dir = temp("pult-gitlog-");
    const log = join(dir, "log");
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> ${log}\nexec ${Bun.which("git")} "$@"\n`, { mode: 0o755 });
    await render(payload, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
    return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "") : [];
  };

  const repoRoot = resolve(import.meta.dir, "..");

  test("shells out once when the payload names the repository", async () => {
    const calls = await spawns({ model: { display_name: "Opus" }, workspace: { current_dir: repoRoot, repo: { name: "pult" } } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("status");
  });

  test("pays for a second call only when the repository has no name", async () => {
    const calls = await spawns({ model: { display_name: "Opus" }, workspace: { current_dir: repoRoot } });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("rev-parse");
  });

  // Unnamed is the normal shape outside a repository: nothing to identify, nothing sent.
  test("does not pay for a name where status found no work tree", async () => {
    const calls = await spawns({ model: { display_name: "Opus" }, workspace: { current_dir: temp("pult-plain-") } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("status");
  });

  // status answers where rev-parse used to refuse: HEAD is not a revision yet.
  test("shows the branch in a repository with no commits", async () => {
    const dir = join(temp("pult-fresh-"), "unborn");
    mkdirSync(dir, { recursive: true });
    Bun.spawnSync(["git", "-C", dir, "-c", "init.defaultBranch=main", "init", "-q"], { stdout: "ignore", stderr: "ignore" });
    const { out, code } = await render({ model: { display_name: "Opus" }, workspace: { current_dir: dir } });
    expect(code).toBe(0);
    expect(out).toContain("unborn:main");
  });

  test("names the repository, not the worktree directory, when the payload omits the name", async () => {
    const tree = worktree();
    const { out, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: tree, git_worktree: "wt-demo" },
    });
    expect(code).toBe(0);
    // Not "wt-demo:wt-demo", which is what the directory would give.
    expect(out).toContain("pult-fixture:wt-demo (wt)");
  });

  // An empty name is a string, so it used to slip past both fallbacks and print ":main".
  test("treats an empty repo name as absent rather than as a name", async () => {
    const tree = worktree();
    const { out, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: tree, repo: { name: "" } },
    });
    expect(code).toBe(0);
    expect(out).toContain("pult-fixture:wt-demo");
    expect(out).not.toContain(" :");
  });

  test("drops the repo section rather than ending the line on a separator", async () => {
    // "/" has no last segment and is no repository, so every name is empty.
    const { out, code } = await render({ model: { display_name: "Opus" }, workspace: { current_dir: "/" } });
    expect(code).toBe(0);
    expect(out.trim()).toBe("Opus");
  });

  test("keeps the worktree alone rather than spacing it off an empty name", async () => {
    const { out, code } = await render({ model: { display_name: "Opus" }, workspace: { current_dir: "/", git_worktree: "review" } });
    expect(code).toBe(0);
    expect(out.trim()).toBe("Opus │ (wt review)");
  });

  test("marks a worktree instead of repeating the branch it is named after", async () => {
    const tree = worktree();
    const { out, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: tree, repo: { name: "kesha-voice-kit" } },
      worktree: { name: "wt-demo" },
    });
    expect(code).toBe(0);
    expect(out).toContain("kesha-voice-kit:wt-demo (wt)");
    expect(out).not.toContain("(wt wt-demo)");
  });

  // The dirty marker rides on the branch, so comparing the two raw misses here.
  test("marks a worktree named after a branch that has uncommitted changes", async () => {
    const tree = worktree();
    const git = (...a: string[]) => Bun.spawnSync(["git", "-C", tree, ...a], { stdout: "ignore", stderr: "ignore" });
    writeFileSync(join(tree, "f.txt"), "one");
    git("add", "f.txt");
    git("-c", "user.email=pult@example.com", "-c", "user.name=pult", "commit", "-q", "-m", "add");
    writeFileSync(join(tree, "f.txt"), "two");
    const { out, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: tree, repo: { name: "kesha-voice-kit" } },
      worktree: { name: "wt-demo" },
    });
    expect(code).toBe(0);
    expect(out).toContain("kesha-voice-kit:wt-demo* (wt)");
  });

  test("keeps a worktree name that differs from the branch", async () => {
    const tree = worktree();
    const { out, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: tree, repo: { name: "kesha-voice-kit" } },
      worktree: { name: "hotfix" },
    });
    expect(code).toBe(0);
    expect(out).toContain("kesha-voice-kit:wt-demo (wt hotfix)");
  });

  // repo already learned this: an empty string is a string, so ?? walks past the
  // fallback and the section vanishes instead of falling through to it.
  test("treats an empty worktree name as absent rather than as a name", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: "/", git_worktree: "review" },
      worktree: { name: "" },
    });
    expect(code).toBe(0);
    expect(out.trim()).toBe("Opus │ (wt review)");
  });

  // git_worktree is the worktree's name, not a path: worktree.path is the field that
  // carries one, and nothing here reads it. A name goes out whole.
  test("prints a worktree name that contains a separator whole", async () => {
    const { out, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: "/", git_worktree: "team/review" },
    });
    expect(code).toBe(0);
    expect(out.trim()).toBe("Opus │ (wt team/review)");
  });

  test("keeps the payload's repo name ahead of the one git knows", async () => {
    const tree = worktree();
    const { out, code } = await render({
      model: { display_name: "Opus" },
      workspace: { current_dir: tree, repo: { name: "kesha-voice-kit" } },
    });
    expect(code).toBe(0);
    expect(out).toContain("kesha-voice-kit:wt-demo");
    expect(out).not.toContain("pult-fixture");
  });

  test("falls back to the directory name outside a repository", async () => {
    const dir = temp("pult-norepo-");
    const { out, code } = await render({ model: { display_name: "Opus" }, workspace: { current_dir: dir } });
    expect(code).toBe(0);
    expect(out).toContain(basename(dir));
  });

  // The wrapper is what settings.json names, so each branch of it is covered here:
  // it runs outside any shell profile, where PATH and the clone's location vary.
  async function wrap(bin: string, env: Record<string, string>): Promise<{ out: string; code: number }> {
    const proc = Bun.spawn([bin], { cwd: tmpdir(), stdin: "pipe", stdout: "pipe", stderr: "pipe", env });
    proc.stdin.write(JSON.stringify({ model: { display_name: "Opus" } }));
    proc.stdin.end();
    const out = (await new Response(proc.stdout).text()).replace(/\x1b\[[0-9;]*m/g, "");
    return { out, code: await proc.exited };
  }

  const onPath = { HOME: process.env.HOME ?? "", PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };

  test("the wrapper finds pult.ts through a symlink, from any cwd", async () => {
    const link = join(temp("pult-link-"), "pult");
    symlinkSync(wrapper, link);
    const { out, code } = await wrap(link, onPath);
    expect(code).toBe(0);
    expect(out).toContain("Opus");
  });

  test("the wrapper finds a bun that is not on PATH", async () => {
    const home = temp("pult-home-");
    mkdirSync(join(home, ".bun", "bin"), { recursive: true });
    symlinkSync(process.execPath, join(home, ".bun", "bin", "bun"));
    const { out, code } = await wrap(wrapper, { HOME: home, PATH: "/usr/bin:/bin" });
    expect(code).toBe(0);
    expect(out).toContain("Opus");
  });

  // Nothing else covers the absolute fallbacks: a dropped candidate would show up only
  // as the "bun not found" test staying green for the wrong reason.
  test("the wrapper finds a bun at an absolute fallback path", async () => {
    const root = temp("pult-sysroot-bun-");
    mkdirSync(join(root, "usr", "local", "bin"), { recursive: true });
    symlinkSync(process.execPath, join(root, "usr", "local", "bin", "bun"));
    const { out, code } = await wrap(wrapper, {
      HOME: temp("pult-nobun-"),
      PATH: "/usr/bin:/bin",
      PULT_SYSROOT: root,
    });
    expect(code).toBe(0);
    expect(out).toContain("Opus");
  });

  test("the wrapper says pult.ts is missing instead of failing", async () => {
    const orphan = join(temp("pult-orphan-"), "pult");
    copyFileSync(wrapper, orphan);
    const { out, code } = await wrap(orphan, onPath);
    expect(code).toBe(0);
    expect(out).toContain("pult.ts not found");
  });

  test("the wrapper says bun is missing instead of failing", async () => {
    // Without PULT_SYSROOT this asserts nothing on a machine that has /opt/homebrew/bin/bun.
    const { out, code } = await wrap(wrapper, {
      HOME: temp("pult-nobun-"),
      PATH: "/usr/bin:/bin",
      PULT_SYSROOT: temp("pult-sysroot-"),
    });
    expect(code).toBe(0);
    expect(out).toContain("bun not found");
  });

  // --zapara reads the file `zapara status` writes and keeps it fresh by starting zapara.
  // Each test gets its own HOME (the file), TMPDIR (the single-flight marker) and a zapara
  // on PATH that only logs its arguments, so the count of starts is a fact, not a claim.
  const zapara = (status: unknown) => {
    const home = temp("pult-zapara-");
    const bin = join(home, "bin");
    const log = join(home, "starts");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "zapara"), `#!/bin/sh\necho "$*" >> ${log}\n`, { mode: 0o755 });
    if (status !== null) {
      mkdirSync(join(home, ".claude", "zapara"), { recursive: true });
      writeFileSync(join(home, ".claude", "zapara", "status.json"), typeof status === "string" ? status : JSON.stringify(status) + "\n");
    }
    const env = { ...process.env, HOME: home, TMPDIR: home, PATH: `${bin}:${process.env.PATH}` };
    // The start is backgrounded and unwaited, so the log lands after the render returns,
    // and on macOS a freshly written script is checked for a few hundred milliseconds
    // before it first runs. The single-flight marker is written before any start, so no
    // marker means no start and nothing to wait for.
    const marker = join(home, `pult-zapara-${process.getuid?.() ?? 0}`);
    const starts = async (): Promise<string[]> => {
      for (let i = 0; i < 40 && existsSync(marker) && !existsSync(log); i++) await Bun.sleep(50);
      return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "") : [];
    };
    return { env, starts };
  };
  // A file as zapara writes it, with asOf this many milliseconds ago.
  const statusAt = (ago: number, over: Record<string, unknown> = {}) => ({
    schema: 1, asOf: new Date(Date.now() - ago).toISOString(), date: "2026-09-19", hour: 15, index: 36, level: "Warming", peak: 41, activeMin: 555, streakMin: 166, ...over,
  });
  const opus = { model: { display_name: "Opus" }, workspace: { current_dir: "/" } };

  test("shows nothing from zapara and starts nothing without --zapara", async () => {
    const z = zapara(statusAt(10 * 60_000));
    const { out, code } = await render(opus, z.env);
    expect(code).toBe(0);
    expect(out.trim()).toBe("Opus");
    expect(await z.starts()).toEqual([]);
  });

  test("prints today's load after the rate limits and leaves a fresh file alone", async () => {
    const z = zapara(statusAt(60_000));
    const { out, raw, code } = await render({ ...opus, rate_limits: { five_hour: { used_percentage: 10 } } }, z.env, ["--zapara"]);
    expect(code).toBe(0);
    expect(out.trim()).toBe("Opus │ 5h 10% │ load 36");
    expect(raw).toContain("\x1b[33mload 36");
    expect(await z.starts()).toEqual([]);
  });

  test("colours the load by zapara's word for it, so the thresholds live in one place", async () => {
    for (const [level, colour] of [["Calm", "\x1b[32m"], ["Warming", "\x1b[33m"], ["Heating", "\x1b[31m"], ["Fried", "\x1b[1m\x1b[31m"]]) {
      const z = zapara(statusAt(0, { level }));
      const { raw, code } = await render(opus, z.env, ["--zapara"]);
      expect(code).toBe(0);
      expect(raw).toContain(`${colour}load 36`);
    }
  });

  test("prints a dash for an hour with no activity yet", async () => {
    const z = zapara(statusAt(0, { index: null, level: null }));
    const { out, code } = await render(opus, z.env, ["--zapara"]);
    expect(code).toBe(0);
    expect(out.trim()).toBe("Opus │ load -");
  });

  test("starts zapara once for a stale file and keeps printing the old value dimmed", async () => {
    const z = zapara(statusAt(6 * 60_000));
    const first = await render(opus, z.env, ["--zapara"]);
    expect(first.code).toBe(0);
    expect(first.raw).toContain("\x1b[2mload 36");
    // The file is still stale on the next render, and the marker says a start is pending.
    const second = await render(opus, z.env, ["--zapara"]);
    expect(second.out.trim()).toBe("Opus │ load 36");
    expect(await z.starts()).toEqual(["status"]);
  });

  test("starts zapara for a missing file and prints no segment", async () => {
    const z = zapara(null);
    const { out, code } = await render(opus, z.env, ["--zapara"]);
    expect(code).toBe(0);
    expect(out.trim()).toBe("Opus");
    expect(await z.starts()).toEqual(["status"]);
  });

  // Every field is checked, not just the two printed: a file that fails is no data.
  test("treats a file it cannot trust as no data", async () => {
    const bad: unknown[] = [
      statusAt(0, { schema: 2 }),
      statusAt(0, { index: "36" }),
      statusAt(0, { index: 136 }),
      statusAt(0, { level: "Hot" }),
      statusAt(0, { index: null }),
      statusAt(0, { hour: 24 }),
      statusAt(0, { streakMin: -1 }),
      statusAt(0, { peak: undefined }),
      statusAt(-2 * 60_000),
      "not json",
    ];
    for (const status of bad) {
      const z = zapara(status);
      const { out, code } = await render(opus, z.env, ["--zapara"]);
      expect(code).toBe(0);
      expect([JSON.stringify(status), out.trim()]).toEqual([JSON.stringify(status), "Opus"]);
    }
  });
});
