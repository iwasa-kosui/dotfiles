import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readActivities,
  recordActivity,
} from "../dot_local/lib/worktree-activity";

describe("worktree activity", () => {
  test("keeps one latest record per worktree and source", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "worktree-activity-"));

    await recordActivity("/repo/.wt/feat-a", "claude", { stateDir, now: 10 });
    await recordActivity("/repo/.wt/feat-a", "claude", { stateDir, now: 20 });

    expect(await readActivities({ stateDir })).toEqual([
      expect.objectContaining({
        path: "/repo/.wt/feat-a",
        source: "claude",
        lastUsedAt: 20,
      }),
    ]);
  });

  test("keeps activity for each source separately", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "worktree-activity-"));

    await recordActivity("/repo/.wt/feat-a", "claude", { stateDir, now: 10 });
    await recordActivity("/repo/.wt/feat-a", "nvim", { stateDir, now: 20 });

    expect(await readActivities({ stateDir })).toEqual([
      { path: "/repo/.wt/feat-a", source: "claude", lastUsedAt: 10 },
      { path: "/repo/.wt/feat-a", source: "nvim", lastUsedAt: 20 },
    ]);
  });

  test("ignores malformed records", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "worktree-activity-"));
    await writeFile(join(stateDir, "broken.json"), "{");

    expect(await readActivities({ stateDir })).toEqual([]);
  });
});
