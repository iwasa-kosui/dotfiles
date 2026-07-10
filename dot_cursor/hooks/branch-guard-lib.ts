import { dirname } from "node:path";

import { runSafe } from "./lib.ts";
import {
  PROTECTED_BRANCHES,
  allowResponse,
  denyResponse,
} from "./repo-guard-lib.ts";
import {
  GIT_PREFIX,
  normalizeShellCommand,
  resolveShellHookCwd,
  type ShellHookInput,
} from "./shell-hook-lib.ts";

export type BlockedOperation = { pattern: RegExp; label: string };

export const blockedOperations: BlockedOperation[] = [
  {
    // git checkout -- <file> / --patch によるファイル復元は許可
    pattern: new RegExp(
      `${GIT_PREFIX.source}(switch|checkout)\\b(?!.*\\s--\\s)(?!.*--patch)(?!.*-p\\b)`,
    ),
    label: "ブランチ切り替え",
  },
  {
    // --dry-run はコミットしないので許可
    pattern: new RegExp(`${GIT_PREFIX.source}commit\\b(?!.*--dry-run)`),
    label: "コミット",
  },
  {
    // --abort は中断のみなので許可
    pattern: new RegExp(`${GIT_PREFIX.source}merge\\b(?!.*--abort)`),
    label: "マージ",
  },
  {
    pattern: new RegExp(
      `${GIT_PREFIX.source}rebase\\b(?!.*--abort)(?!.*--show-current-patch)`,
    ),
    label: "リベース",
  },
  {
    pattern: new RegExp(`${GIT_PREFIX.source}cherry-pick\\b(?!.*--abort)`),
    label: "cherry-pick",
  },
  {
    pattern: new RegExp(`${GIT_PREFIX.source}revert\\b(?!.*--abort)`),
    label: "revert",
  },
  {
    pattern: new RegExp(`${GIT_PREFIX.source}reset\\b`),
    label: "reset",
  },
  {
    // pull はmainをfast-forwardしてしまうのでブロック。同期は fetch を使う
    pattern: new RegExp(`${GIT_PREFIX.source}pull\\b`),
    label: "pull",
  },
  {
    pattern: new RegExp(`${GIT_PREFIX.source}(apply|am)\\b(?!.*--abort)`),
    label: "パッチ適用",
  },
];

export type BranchGuardInput = ShellHookInput;

export type BranchGuardResult =
  | { action: "allow" }
  | { action: "deny"; reason: string };

export async function checkMainBranchGuard(
  command: string,
  cwd: string,
): Promise<BranchGuardResult> {
  const matched = blockedOperations.find(({ pattern }) => pattern.test(command));
  if (!matched) {
    return { action: "allow" };
  }

  const branch = await runSafe(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
  });
  if (
    !branch ||
    !PROTECTED_BRANCHES.includes(
      branch as (typeof PROTECTED_BRANCHES)[number],
    )
  ) {
    return { action: "allow" };
  }

  if (cwd.includes("/.wt/")) {
    return { action: "allow" };
  }

  const repoRoot = await runSafe(["git", "rev-parse", "--show-toplevel"], {
    cwd,
  });
  if (repoRoot?.includes("/.wt/")) {
    return { action: "allow" };
  }

  const gitDir = await runSafe(["git", "rev-parse", "--git-dir"], { cwd });
  if (gitDir?.includes(".git/worktrees")) {
    return { action: "allow" };
  }

  if (gitDir && !gitDir.endsWith("/.git")) {
    const absoluteGitDir = gitDir.startsWith("/")
      ? gitDir
      : `${cwd}/${gitDir}`;
    if (dirname(absoluteGitDir).includes("/.git/worktrees")) {
      return { action: "allow" };
    }
  }

  const reason = `保護ブランチ(${branch})での ${matched.label} はブロックされています。worktreeを作成して作業してください。`;
  return { action: "deny", reason };
}

export async function runMainBranchGuard(input: BranchGuardInput): Promise<void> {
  const command = normalizeShellCommand(input);
  if (!command) {
    allowResponse();
    return;
  }

  const cwd = resolveShellHookCwd(input);
  const result = await checkMainBranchGuard(command, cwd);
  if (result.action === "deny") {
    denyResponse(result.reason);
    return;
  }

  allowResponse();
}
