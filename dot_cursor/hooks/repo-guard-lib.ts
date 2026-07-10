import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";

import { runSafe } from "./lib.ts";

export const PROTECTED_BRANCHES = ["main", "master", "develop"] as const;

export const WRITE_TOOL_NAMES = new Set([
  "Write",
  "StrReplace",
  "Delete",
  "EditNotebook",
  "ApplyPatch",
  "TabWrite",
]);

export function expandHome(path: string): string {
  return path
    .replace(/^\$HOME(?=\/|$)/, homedir())
    .replace(/^~(?=\/|$)/, homedir());
}

export type RepoGuardResult =
  | { action: "allow" }
  | { action: "deny"; branch: string; reason: string };

export async function checkProtectedMainRepo(
  targetPath: string,
  resolveCwd: string,
): Promise<RepoGuardResult> {
  const normalized = expandHome(targetPath);
  const absolutePath = isAbsolute(normalized)
    ? normalized
    : resolve(resolveCwd, normalized);
  return checkProtectedMainRepoGitCwd(dirname(absolutePath));
}

export async function checkProtectedMainRepoCwd(
  cwd: string,
): Promise<RepoGuardResult> {
  const absoluteCwd = expandHome(cwd);
  return checkProtectedMainRepoGitCwd(absoluteCwd);
}

async function checkProtectedMainRepoGitCwd(
  gitCwd: string,
): Promise<RepoGuardResult> {
  const repoRoot = await runSafe([
    "git",
    "-C",
    gitCwd,
    "rev-parse",
    "--show-toplevel",
  ]);
  if (!repoRoot) {
    return { action: "allow" };
  }

  if (gitCwd.includes("/.wt/") || repoRoot.includes("/.wt/")) {
    return { action: "allow" };
  }

  const gitDir = await runSafe(["git", "-C", gitCwd, "rev-parse", "--git-dir"]);
  if (gitDir?.includes(".git/worktrees")) {
    return { action: "allow" };
  }

  const branch = await runSafe([
    "git",
    "-C",
    gitCwd,
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (!branch || !PROTECTED_BRANCHES.includes(branch as (typeof PROTECTED_BRANCHES)[number])) {
    return { action: "allow" };
  }

  const reason = `メインリポジトリの保護ブランチ(${branch})でのファイル変更はブロックされています。worktreeを作成して作業してください。`;
  return { action: "deny", branch, reason };
}

export function denyResponse(reason: string): void {
  console.log(
    JSON.stringify({
      permission: "deny",
      user_message: reason,
      agent_message: reason,
    }),
  );
}

export function allowResponse(): void {
  console.log(JSON.stringify({ permission: "allow" }));
}
