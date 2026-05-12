#!/usr/bin/env bun
// PreToolUse hook: mainブランチで履歴・状態を変更するgitコマンドをブロック

import { readInput, runSafe } from "./lib.ts";

const input = await readInput<{ tool_input?: { command?: string } }>();
const command = input.tool_input?.command ?? "";

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

const branch = await runSafe(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main" && branch !== "master") {
  process.exit(0);
}

// worktree内なら（mainブランチ判定がそもそも稀だが）許可
const gitDir = await runSafe(["git", "rev-parse", "--git-dir"]);
if (gitDir?.includes(".git/worktrees")) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason: `mainブランチでの ${matched.label} はブロックされています。worktreeを作成して作業してください。`,
  }),
);
