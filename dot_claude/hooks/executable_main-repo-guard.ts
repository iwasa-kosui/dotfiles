#!/usr/bin/env bun
// PreToolUse hook: メインリポジトリ（非worktree）の保護ブランチでファイル変更をブロック

import { readInput, runSafe } from "./lib.ts";

// stdinからツール入力を取得
const input = await readInput<{ tool_input?: { file_path?: string } }>();
const filePath = input.tool_input?.file_path ?? "";

// file_pathが未指定ならブロック対象外
if (!filePath) {
  process.exit(0);
}

// リポジトリ外のパス（/tmp等）なら許可
const repoRoot = await runSafe(["git", "rev-parse", "--show-toplevel"]);
if (repoRoot && !filePath.startsWith(repoRoot + "/") && filePath !== repoRoot) {
  process.exit(0);
}

// 操作対象が.wt/配下なら許可
if (filePath.includes("/.wt/")) {
  process.exit(0);
}

// worktree内なら許可
const gitDir = await runSafe(["git", "rev-parse", "--git-dir"]);
if (gitDir?.includes(".git/worktrees")) {
  process.exit(0);
}

// 保護ブランチでなければ許可
const protectedBranches = ["main", "master", "develop"];
const branch = await runSafe(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
if (!branch || !protectedBranches.includes(branch)) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason:
      `メインリポジトリの保護ブランチ(${branch})でのファイル変更はブロックされています。worktreeを作成して作業してください。`,
  }),
);
