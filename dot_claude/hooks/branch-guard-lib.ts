// 保護ブランチで履歴・状態を変更する git コマンドを判定する。
// dot_claude/hooks/ dot_codex/hooks/ dot_cursor/hooks/ の3箇所で同一内容を保つこと。
// 拒否レスポンスの JSON 形式はプラットフォームごとに違うため、各 hook 側で組み立てる。

import { dirname } from "node:path";

import { runSafe } from "./lib.ts";
import { GIT_PREFIX, isProtectedBranch } from "./shell-hook-lib.ts";

export type BlockedOperation = { pattern: RegExp; label: string };

// サブコマンド名の直後にハイフンが続くケースは別コマンドなので除外する。
// これを付けないと merge-base / merge-tree / commit-tree / checkout-index が
// 読み取り専用のコマンドなのにブロックされる。
const NOT_HYPHENATED = "(?!-)";

export const blockedOperations: BlockedOperation[] = [
  {
    // git checkout -- <file> / --patch によるファイル復元は許可
    pattern: new RegExp(
      `${GIT_PREFIX.source}(switch|checkout)\\b${NOT_HYPHENATED}(?!.*\\s--\\s)(?!.*--patch)(?!.*-p\\b)`,
    ),
    label: "ブランチ切り替え",
  },
  {
    // --dry-run はコミットしないので許可
    pattern: new RegExp(
      `${GIT_PREFIX.source}commit\\b${NOT_HYPHENATED}(?!.*--dry-run)`,
    ),
    label: "コミット",
  },
  {
    // --abort は中断のみなので許可
    pattern: new RegExp(
      `${GIT_PREFIX.source}merge\\b${NOT_HYPHENATED}(?!.*--abort)`,
    ),
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
  {
    pattern: new RegExp(`${GIT_PREFIX.source}mv\\b`),
    label: "git mv",
  },
];

export function findBlockedOperation(command: string): BlockedOperation | undefined {
  return blockedOperations.find(({ pattern }) => pattern.test(command));
}

export type BranchGuardResult =
  | { action: "allow" }
  | { action: "deny"; reason: string };

async function isInWorktree(cwd: string): Promise<boolean> {
  if (cwd.includes("/.wt/")) {
    return true;
  }

  const repoRoot = await runSafe(["git", "rev-parse", "--show-toplevel"], {
    cwd,
  });
  if (repoRoot?.includes("/.wt/")) {
    return true;
  }

  const gitDir = await runSafe(["git", "rev-parse", "--git-dir"], { cwd });
  if (!gitDir) {
    return false;
  }
  if (gitDir.includes(".git/worktrees")) {
    return true;
  }

  // --git-dir は相対パスで返ることがあるため cwd 基準で絶対化してから判定する
  if (!gitDir.endsWith("/.git")) {
    const absoluteGitDir = gitDir.startsWith("/") ? gitDir : `${cwd}/${gitDir}`;
    if (dirname(absoluteGitDir).includes("/.git/worktrees")) {
      return true;
    }
  }

  return false;
}

export async function checkMainBranchGuard(
  command: string,
  cwd: string,
): Promise<BranchGuardResult> {
  const matched = findBlockedOperation(command);
  if (!matched) {
    return { action: "allow" };
  }

  const branch = await runSafe(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
  });
  if (!branch || !isProtectedBranch(branch)) {
    return { action: "allow" };
  }

  if (await isInWorktree(cwd)) {
    return { action: "allow" };
  }

  const reason = `保護ブランチ(${branch})での ${matched.label} はブロックされています。worktreeを作成して作業してください。`;
  return { action: "deny", reason };
}
