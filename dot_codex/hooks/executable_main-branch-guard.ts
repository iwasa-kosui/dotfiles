#!/usr/bin/env bun
// PreToolUse hook: mainブランチで履歴・状態を変更するgitコマンドをブロック

import { dirname } from "node:path";
import { readInput, runSafe } from "./lib.ts";

const input = await readInput<{
  tool_input?: { command?: string; cwd?: string; workdir?: string };
}>();
const command = input.tool_input?.command ?? "";

const gitCwdMatch = command.match(/\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
const gitCwd = gitCwdMatch?.[1] ?? gitCwdMatch?.[2] ?? gitCwdMatch?.[3];

type BlockedOperation = { pattern: RegExp; label: string };

const blockedOperations: BlockedOperation[] = [
  {
    // git checkout -- <file> / --patch によるファイル復元は許可
    pattern: /\bgit\s+(switch|checkout)\b(?!.*\s--\s)(?!.*--patch)(?!.*-p\b)/,
    label: "ブランチ切り替え",
  },
  {
    // --dry-run はコミットしないので許可
    pattern: /\bgit\s+commit\b(?!.*--dry-run)/,
    label: "コミット",
  },
  {
    // --abort は中断のみなので許可
    pattern: /\bgit\s+merge\b(?!.*--abort)/,
    label: "マージ",
  },
  {
    pattern: /\bgit\s+rebase\b(?!.*--abort)(?!.*--show-current-patch)/,
    label: "リベース",
  },
  {
    pattern: /\bgit\s+cherry-pick\b(?!.*--abort)/,
    label: "cherry-pick",
  },
  {
    pattern: /\bgit\s+revert\b(?!.*--abort)/,
    label: "revert",
  },
  {
    pattern: /\bgit\s+reset\b/,
    label: "reset",
  },
  {
    // pull はmainをfast-forwardしてしまうのでブロック。同期は fetch を使う
    pattern: /\bgit\s+pull\b/,
    label: "pull",
  },
  {
    pattern: /\bgit\s+(apply|am)\b(?!.*--abort)/,
    label: "パッチ適用",
  },
];

const matched = blockedOperations.find(({ pattern }) => pattern.test(command));
if (!matched) {
  process.exit(0);
}

const cwd = input.tool_input?.cwd ?? input.tool_input?.workdir ?? gitCwd;
const branch = await runSafe(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
  cwd: cwd ?? undefined,
});
if (branch !== "main" && branch !== "master") {
  process.exit(0);
}

// worktree内なら（mainブランチ判定がそもそも稀だが）許可
const gitDir = await runSafe(["git", "rev-parse", "--git-dir"], {
  cwd: cwd ?? undefined,
});
if (gitDir?.includes(".git/worktrees")) {
  process.exit(0);
}

if (gitDir && !gitDir.endsWith("/.git")) {
  const absoluteGitDir = gitDir.startsWith("/")
    ? gitDir
    : `${cwd ?? ""}/${gitDir}`;
  if (dirname(absoluteGitDir).includes("/.git/worktrees")) {
    process.exit(0);
  }
}

const repoRoot = await runSafe(["git", "rev-parse", "--show-toplevel"], {
  cwd: cwd ?? undefined,
});
if (repoRoot?.includes("/.wt/")) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason: `mainブランチでの ${matched.label} はブロックされています。worktreeを作成して作業してください。`,
  }),
);
