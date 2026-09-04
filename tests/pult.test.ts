import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const script = resolve(import.meta.dir, "..", "pult.ts");
const wrapper = resolve(import.meta.dir, "..", "pult");

async function render(payload: unknown): Promise<{ out: string; raw: string; code: number }> {
  const proc = Bun.spawn(["bun", script], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
  proc.stdin.end();
  const raw = await new Response(proc.stdout).text();
  const out = raw.replace(/\x1b\[[0-9;]*m/g, "");
  return { out, raw, code: await proc.exited };
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
    expect(out.trim()).toMatch(/^Fable 5\.1 │ ctx 41% 414k\/1\.0M │ \$4\.21 · 1h30 │ \+156\/-23 │ 5h 24% · 7d 81% ↻83h\d\d │ kesha-voice-kit(:\S+)? │ PR #1150 pending$/);
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

  // Every field arrives from an upstream JSON schema, so "optional" in the type
  // is not a guarantee of type at runtime: JSON says null, and keys can change.
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

  // A reset time only matters once a window is close enough to bite, so it rides
  // the same yellow threshold the color does.
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
    // The section is dropped whole rather than joining an empty string between
    // two separators, which read as "Opus │  │ repo".
    expect(out).not.toMatch(/│\s+│/);
  });

  test("treats a fast_mode that is not a boolean as off", async () => {
    // JSON carries the word, not the value: "false" is a string and every
    // non-empty one is truthy.
    for (const fast_mode of ["false", "no", 1, {}, []]) {
      const { out, code } = await render({ model: { display_name: "Opus" }, fast_mode });
      expect(code).toBe(0);
      expect(out).not.toContain("fast");
    }
    const { out } = await render({ model: { display_name: "Opus" }, fast_mode: true });
    expect(out).toContain("fast");
  });

  // Found by exploration: the environment fails in ways the payload cannot.
  test("survives git missing from PATH", async () => {
    // Bun.spawnSync throws ENOENT rather than returning a non-zero exit, and the
    // status line runs outside any shell profile, where PATH is whatever it is.
    const proc = Bun.spawn([process.execPath, script], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: "/nonexistent" },
    });
    proc.stdin.write(JSON.stringify({ model: { display_name: "Opus" }, workspace: { current_dir: "/tmp", repo: { name: "pult" } } }));
    proc.stdin.end();
    const raw = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(0);
    expect(err).toBe("");
    expect(raw.replace(/\x1b\[[0-9;]*m/g, "")).toBe("Opus │ pult\n");
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

  // The context percentage is rounded wherever it came from, so the section reads the
  // same width whether the sender supplied it or it was computed from current_usage.
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

  // The wrapper is what settings.json names, so each branch of it is covered here:
  // it runs outside any shell profile, where PATH and the clone's location vary.
  const temps: string[] = [];
  const temp = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    temps.push(dir);
    return dir;
  };
  afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

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

  // The other direction of the same probe: the absolute fallbacks must still hit.
  // Nothing else covers them, so a dropped candidate or fumbled quoting would only
  // ever show up as the "bun not found" test staying green for the wrong reason.
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
});
