#!/usr/bin/env bun
// PreToolUse hook: mainブランチのworktreeでブランチ切り替えをブロック

import { readInput, runSafe } from "./lib.ts";

const input = await readInput<{ tool_input?: { command?: string } }>();
const command = input.tool_input?.command ?? "";

// git switch / git checkout でブランチ切り替えを行うコマンドかどうか判定
// git checkout -- <file> (ファイル復元) は許可する
const branchSwitchPattern =
  /\bgit\s+(switch|checkout)\b(?!.*\s--\s)(?!.*--patch)(?!.*-p\b)/;
if (!branchSwitchPattern.test(command)) {
  process.exit(0);
}

// 現在のブランチを取得
const branch = await runSafe(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main" && branch !== "master") {
  process.exit(0);
}

// worktree内ならブランチ切り替えを許可
const gitDir = await runSafe(["git", "rev-parse", "--git-dir"]);
if (gitDir?.includes(".git/worktrees")) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason: `mainブランチでのブランチ切り替えはブロックされています。worktreeを作成して作業してください。`,
  }),
);
