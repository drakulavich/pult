import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const script = resolve(import.meta.dir, "..", "pult.ts");
const wrapper = resolve(import.meta.dir, "..", "pult");

async function render(payload: unknown): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(["bun", script], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
  proc.stdin.end();
  const out = (await new Response(proc.stdout).text()).replace(/\x1b\[[0-9;]*m/g, "");
  return { out, code: await proc.exited };
}

describe("pult", () => {
  test("renders every populated section in order", async () => {
    const { out, code } = await render({
      model: { display_name: "Fable 5.1" },
      workspace: { current_dir: "/tmp", repo: { name: "kesha-voice-kit" } },
      cost: { total_cost_usd: 4.2137, total_duration_ms: 5_400_000, total_lines_added: 156, total_lines_removed: 23 },
      context_window: { context_window_size: 1_000_000, used_percentage: 41, current_usage: { input_tokens: 8500, cache_creation_input_tokens: 5000, cache_read_input_tokens: 400_000 } },
      rate_limits: { five_hour: { used_percentage: 23.5, resets_at: Math.floor(Date.now() / 1000) + 7800 } },
      pr: { number: 1150, review_state: "pending" },
    });
    expect(code).toBe(0);
    expect(out.trim()).toMatch(/^Fable 5\.1 │ ctx 41% 414k\/1\.0M │ \$4\.21 · 1h30 │ \+156\/-23 │ 5h 24% ↻2h0\d │ kesha-voice-kit(:\S+)? │ PR #1150 pending$/);
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

  test("the wrapper says what is missing instead of failing", async () => {
    const orphan = join(temp("pult-orphan-"), "pult");
    copyFileSync(wrapper, orphan);
    const { out, code } = await wrap(orphan, onPath);
    expect(code).toBe(0);
    expect(out).toContain("pult.ts not found");

    const { out: noBun, code: noBunCode } = await wrap(wrapper, { HOME: temp("pult-nobun-"), PATH: "/usr/bin:/bin" });
    expect(noBunCode).toBe(0);
    expect(noBun).toContain("bun not found");
  });
});
