import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
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

  test("the wrapper finds pult.ts through a symlink, from any cwd", async () => {
    const link = join(mkdtempSync(join(tmpdir(), "pult-")), "pult");
    symlinkSync(wrapper, link);
    const proc = Bun.spawn([link], {
      cwd: tmpdir(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      // No profile is sourced for a status line: only bun's own dir is on PATH.
      env: { HOME: process.env.HOME ?? "", PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
    });
    proc.stdin.write(JSON.stringify({ model: { display_name: "Opus" } }));
    proc.stdin.end();
    const out = (await new Response(proc.stdout).text()).replace(/\x1b\[[0-9;]*m/g, "");
    expect(await proc.exited).toBe(0);
    expect(out).toContain("Opus");
  });
});
