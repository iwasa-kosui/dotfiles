import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const config = join(import.meta.dir, "..", "Library", "Application Support", "lazygit", "config.yml");

describe("lazygit config", () => {
  test("uses Worktrees as the third side panel", async () => {
    const yaml = await readFile(config, "utf8");
    expect(yaml).toContain("- [status]");
    expect(yaml).toContain("- [files, submodules]");
    expect(yaml).toContain("- [worktrees, branches, remotes, tags]");
    expect(yaml.indexOf("[worktrees")).toBeLessThan(yaml.indexOf("[commits"));
  });

  test("quotes every selected branch passed to the bridge", async () => {
    const yaml = await readFile(config, "utf8");
    expect(yaml).toContain(".SelectedWorktree.Branch | quote");
    expect(yaml).toContain(".SelectedLocalBranch.Name | quote");
    expect(yaml).toContain(".CheckedOutBranch.Name | quote");
    expect(yaml.match(/key: <f12>/g)).toHaveLength(3);
  });
});
