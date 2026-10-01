import { describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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

function lastNonEmptyLine(text: string): string {
  return text.split("\n").filter((l) => l.trim() !== "").pop() ?? "";
}

async function setupFixture(prefix: string, remoteBranch = "main") {
  // macOS の tmpdir は /var -> /private/var の symlink で、git は実パスを返す
  const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const origin = join(fixtureRoot, "origin.git");
  const repo = join(fixtureRoot, "repo");
  const home = join(fixtureRoot, "home");
  await mkdir(home);
  await runGit(fixtureRoot, [
    "init",
    "--bare",
    `--initial-branch=${remoteBranch}`,
    origin,
  ]);
  await runGit(fixtureRoot, ["init", "--initial-branch=main", repo]);
  await runGit(repo, ["config", "user.name", "Test User"]);
  await runGit(repo, ["config", "user.email", "test@example.com"]);
  await writeFile(join(repo, "version.txt"), "initial\n");
  await runGit(repo, ["add", "version.txt"]);
  await runGit(repo, ["commit", "-m", "initial"]);
  await runGit(repo, ["remote", "add", "origin", origin]);
  await runGit(repo, ["push", "origin", `main:${remoteBranch}`]);
  return { fixtureRoot, origin, repo, home };
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

  test("branches from the remote default branch instead of origin/main", async () => {
    const { fixtureRoot, repo, home } = await setupFixture("worktree-hook-", "develop");

    try {
      await runGit(repo, ["push", "origin", "main:main"]);
      await writeFile(join(repo, "version.txt"), "develop only\n");
      await runGit(repo, ["commit", "-am", "develop only"]);
      await runGit(repo, ["push", "origin", "main:develop"]);
      const developSha = await runGit(repo, ["rev-parse", "HEAD"]);
      const mainSha = await runGit(repo, ["rev-parse", "origin/main"]);
      expect(developSha).not.toBe(mainSha);

      const result = await runWorktreeHook(repo, home, "feat/new-thing");

      expect(result.exitCode, result.stderr).toBe(0);
      const wtPath = join(repo, ".wt", "feat", "new-thing");
      expect(lastNonEmptyLine(result.stdout)).toBe(wtPath);
      expect(await runGit(wtPath, ["rev-parse", "HEAD"])).toBe(developSha);
      expect(await runGit(wtPath, ["symbolic-ref", "--short", "HEAD"])).toBe(
        "feat/new-thing",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("checks out an existing remote branch and tracks it", async () => {
    const { fixtureRoot, repo, home } = await setupFixture("worktree-hook-");

    try {
      await runGit(repo, ["checkout", "-b", "feat/x"]);
      await writeFile(join(repo, "feature.txt"), "feature\n");
      await runGit(repo, ["add", "feature.txt"]);
      await runGit(repo, ["commit", "-m", "feature"]);
      await runGit(repo, ["push", "origin", "feat/x"]);
      const featureSha = await runGit(repo, ["rev-parse", "HEAD"]);
      await runGit(repo, ["checkout", "main"]);
      await runGit(repo, ["branch", "-D", "feat/x"]);

      const result = await runWorktreeHook(repo, home, "feat/x");

      expect(result.exitCode, result.stderr).toBe(0);
      const wtPath = join(repo, ".wt", "feat", "x");
      expect(lastNonEmptyLine(result.stdout)).toBe(wtPath);
      expect(await runGit(wtPath, ["rev-parse", "HEAD"])).toBe(featureSha);
      expect(await runGit(wtPath, ["symbolic-ref", "--short", "HEAD"])).toBe(
        "feat/x",
      );
      expect(await runGit(wtPath, ["config", "branch.feat/x.remote"])).toBe(
        "origin",
      );
      expect(await runGit(wtPath, ["config", "branch.feat/x.merge"])).toBe(
        "refs/heads/feat/x",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("runs wt-link-local-settings in the new worktree and ignores its failure", async () => {
    const { fixtureRoot, repo, home } = await setupFixture("worktree-hook-");

    try {
      const binDir = join(home, ".local", "bin");
      await mkdir(binDir, { recursive: true });
      const stub = join(binDir, "wt-link-local-settings");
      await writeFile(
        stub,
        '#!/bin/sh\npwd -P > "$HOME/link-cwd"\necho "child stdout"\necho "boom" >&2\nexit 1\n',
      );
      await chmod(stub, 0o755);

      const result = await runWorktreeHook(repo, home, "link-check");

      expect(result.exitCode, result.stderr).toBe(0);
      const wtPath = join(repo, ".wt", "link-check");
      expect(lastNonEmptyLine(result.stdout)).toBe(wtPath);
      expect(result.stdout).not.toContain("child stdout");
      expect((await readFile(join(home, "link-cwd"), "utf8")).trim()).toBe(
        await realpath(wtPath),
      );
      const log = await readFile(
        join(home, ".claude", "logs", "worktree.log"),
        "utf8",
      );
      expect(log).toContain("wt-link-local-settings failed");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("succeeds when wt-link-local-settings is not installed", async () => {
    const { fixtureRoot, repo, home } = await setupFixture("worktree-hook-");

    try {
      const result = await runWorktreeHook(repo, home, "no-link");

      expect(result.exitCode, result.stderr).toBe(0);
      expect(lastNonEmptyLine(result.stdout)).toBe(join(repo, ".wt", "no-link"));
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
