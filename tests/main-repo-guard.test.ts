import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runGit(cwd: string, args: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${stderr}`);
  }
}

async function runGuard(cwd: string, filePath: string) {
  const hookPath = join(
    import.meta.dir,
    "..",
    "dot_claude",
    "hooks",
    "executable_main-repo-guard.ts",
  );
  const child = Bun.spawn(["bun", hookPath], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(JSON.stringify({ tool_input: { file_path: filePath } }));
  child.stdin.end();

  const [exitCode, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  return { exitCode, blocked: stdout.includes('"decision":"block"') };
}

describe("Claude main-repo-guard hook", () => {
  let fixtureRoot: string;
  let repo: string;

  beforeAll(async () => {
    // macOSでは/var -> /private/varのsymlinkがあり、git rev-parseは実体パスを返す
    fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), "main-repo-guard-")));
    repo = join(fixtureRoot, "repo");
    await runGit(fixtureRoot, ["init", "--initial-branch=develop", repo]);
    await runGit(repo, ["config", "user.name", "Test User"]);
    await runGit(repo, ["config", "user.email", "test@example.com"]);
    await writeFile(join(repo, "README.md"), "init\n");
    await runGit(repo, ["add", "README.md"]);
    await runGit(repo, ["commit", "-m", "initial"]);
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  test("allows writes under .git/worktrees/<name>/ on a protected branch", async () => {
    const result = await runGuard(
      repo,
      join(repo, ".git", "worktrees", "foo", "AGENT_PR_COMMIT_MSG"),
    );
    expect(result).toEqual({ exitCode: 0, blocked: false });
  });

  test("blocks writes to tracked files on a protected branch", async () => {
    const result = await runGuard(repo, join(repo, "src", "a.ts"));
    expect(result).toEqual({ exitCode: 0, blocked: true });
  });

  test("blocks writes to other .git paths such as .git/config", async () => {
    const result = await runGuard(repo, join(repo, ".git", "config"));
    expect(result).toEqual({ exitCode: 0, blocked: true });
  });

  test("blocks paths that escape .git/worktrees/ via ..", async () => {
    const result = await runGuard(
      repo,
      `${repo}/.git/worktrees/x/../../config`,
    );
    expect(result).toEqual({ exitCode: 0, blocked: true });
  });
});
