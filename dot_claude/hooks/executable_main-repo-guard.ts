#!/usr/bin/env bun
// PreToolUse hook: メインリポジトリ（非worktree）のmainブランチでファイル変更をブロック

import { runSafe } from "./lib.ts";

// worktree内なら許可
const gitDir = await runSafe(["git", "rev-parse", "--git-dir"]);
if (gitDir?.includes(".git/worktrees")) {
  process.exit(0);
}

// mainブランチでなければ許可
const branch = await runSafe(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main" && branch !== "master") {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason:
      "メインリポジトリのmainブランチでのファイル変更はブロックされています。worktreeを作成して作業してください。",
  }),
);
