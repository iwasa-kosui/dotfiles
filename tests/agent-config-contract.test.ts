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

  test("keeps repository-managed adapter paths and the Cursor Draft boundary", async () => {
    const managedPaths = Object.values(manifest.runtimes).flatMap(({ rules, skills, hooks }) => [
      rules,
      skills,
      hooks,
    ]);

    for (const path of managedPaths) {
      expect(existsSync(path)).toBe(true);
    }

    const policy = await Bun.file("agent_policy/contract.md").text();
    const cursorPolicy = await Bun.file("dot_cursor/rules/auto-ship.mdc").text();
    expect(policy).toContain("Draft PR まで");
    expect(policy).toContain("Ready 化");
    expect(cursorPolicy).toMatch(/draft PR まで/i);
  });
});
