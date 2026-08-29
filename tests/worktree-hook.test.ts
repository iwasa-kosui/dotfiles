import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runGit(cwd: string, args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${stderr}`);
  }
  return stdout.trim();
}

async function runWorktreeHook(cwd: string, home: string, name: string) {
  const hookPath = join(
    import.meta.dir,
    "..",
    "dot_claude",
    "hooks",
    "executable_worktree.ts",
  );
  const child = Bun.spawn(["bun", hookPath], {
    cwd,
    env: { ...Bun.env, HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(
    JSON.stringify({ hook_event_name: "WorktreeCreate", cwd, name }),
  );
  child.stdin.end();

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout: stdout.trim(), stderr };
}

describe("Claude worktree hook", () => {
  test("creates a worktree from the latest origin/main when local main is stale", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "worktree-hook-"));
    const origin = join(fixtureRoot, "origin.git");
    const repo = join(fixtureRoot, "repo");
    const updater = join(fixtureRoot, "updater");
    const home = join(fixtureRoot, "home");

    try {
      await mkdir(home);
      await runGit(fixtureRoot, ["init", "--bare", origin]);
      await runGit(fixtureRoot, ["init", "--initial-branch=main", repo]);
      await runGit(repo, ["config", "user.name", "Test User"]);
      await runGit(repo, ["config", "user.email", "test@example.com"]);
      await writeFile(join(repo, "version.txt"), "local main\n");
      await runGit(repo, ["add", "version.txt"]);
      await runGit(repo, ["commit", "-m", "initial"]);
      await runGit(repo, ["remote", "add", "origin", origin]);
      await runGit(repo, ["push", "-u", "origin", "main"]);

      await runGit(fixtureRoot, ["clone", "--branch", "main", origin, updater]);
      await runGit(updater, ["config", "user.name", "Test User"]);
      await runGit(updater, ["config", "user.email", "test@example.com"]);
      await writeFile(join(updater, "version.txt"), "remote main\n");
      await runGit(updater, ["add", "version.txt"]);
      await runGit(updater, ["commit", "-m", "advance remote"]);
      await runGit(updater, ["push", "origin", "main"]);

      const localMain = await runGit(repo, ["rev-parse", "main"]);
      const latestRemoteMain = await runGit(updater, ["rev-parse", "main"]);
      expect(localMain).not.toBe(latestRemoteMain);

      const result = await runWorktreeHook(repo, home, "latest-origin");

      expect(result.exitCode, result.stderr).toBe(0);
      expect(
        await runGit(join(repo, ".wt", "latest-origin"), ["rev-parse", "HEAD"]),
      ).toBe(latestRemoteMain);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
