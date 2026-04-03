#!/usr/bin/env bun
// PreToolUse hook: メインリポジトリ（非worktree）のmainブランチでファイル変更をブロック

import { readInput, runSafe } from "./lib.ts";

// stdinからツール入力を取得し、操作対象が.wt/配下なら許可
const input = await readInput<{ tool_input?: { file_path?: string } }>();
const filePath = input.tool_input?.file_path ?? "";
if (filePath.includes("/.wt/")) {
  process.exit(0);
}

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
