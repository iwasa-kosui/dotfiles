import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

const manifest = await Bun.file("agent_policy/runtime-manifest.json").json();

describe("agent runtime contract", () => {
  test("defines all supported runtimes and Draft ship policy", async () => {
    expect(Object.keys(manifest.runtimes).sort()).toEqual(["claude", "codex", "cursor"]);
    const policy = await Bun.file("agent_policy/contract.md").text();
    expect(policy).toContain("Draft PR");
    expect(policy).toContain("Ready 化");
  });

  test("keeps the Cursor adapter at the Draft PR stage", async () => {
    const policy = await Bun.file("agent_policy/contract.md").text();
    const cursorPolicy = await Bun.file("dot_cursor/rules/auto-ship.mdc").text();
    expect(policy).toContain("Draft PR まで");
    expect(cursorPolicy).toMatch(/draft PR まで/i);
  });

  test("keeps Claude and Cursor managed paths in the repository", () => {
    for (const runtime of ["claude", "cursor"]) {
      const { rules, skills, hooks } = manifest.runtimes[runtime];

      for (const path of [rules, skills, hooks]) {
        expect(existsSync(path)).toBe(true);
      }
    }
  });

  test("Codex instructions have managed rules and no Claude-only execution API", async () => {
    const instructions = await Bun.file("dot_codex/AGENTS.md").text();
    expect(instructions).not.toContain("CLAUDE_CODE_SUBAGENT_MODEL");
    expect(instructions).not.toContain("@RTK.md");
    expect(instructions).toContain("~/.codex/rules/");
    for (const rule of manifest.runtimes.codex.requiredRules) {
      expect(await Bun.file(`dot_codex/rules/${rule}`).exists()).toBe(true);
    }
  });

  test("requires explicit approval after a Draft PR in the common and Cursor policies", async () => {
    const policy = await Bun.file("agent_policy/contract.md").text();
    const cursorPolicy = await Bun.file("dot_cursor/rules/auto-ship.mdc").text();

    for (const source of [policy, cursorPolicy]) {
      expect(source).toContain("Ready 化");
      expect(source).toContain("merge");
      expect(source).toContain("force-push");
      expect(source).toContain("保護ブランチへの直接変更");
      expect(source).toContain("明示的な承認");
    }
  });
});
