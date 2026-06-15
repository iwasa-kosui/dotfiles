#!/usr/bin/env bun
// preToolUse hook: メインリポジトリ（非worktree）のmainブランチでファイル変更をブロック

import { isAbsolute, resolve } from "node:path";

import { readInput, runSafe } from "./lib.ts";

type ToolInput = {
  file_path?: string;
  path?: string;
  target_file?: string;
  old_file_path?: string;
  target_notebook?: string;
};

type PreToolUseInput = {
  tool_input?: ToolInput;
  cwd?: string;
};

const input = await readInput<PreToolUseInput>();

const rawPath =
  input.tool_input?.file_path ??
  input.tool_input?.path ??
  input.tool_input?.target_file ??
  input.tool_input?.old_file_path ??
  input.tool_input?.target_notebook ??
  "";

// file_path相当が未指定ならブロック対象外
if (!rawPath) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const cwd = input.cwd ?? process.cwd();
const targetPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);

// リポジトリ外のパス（/tmp等）なら許可
const repoRoot = await runSafe(["git", "rev-parse", "--show-toplevel"], { cwd });
if (repoRoot && !targetPath.startsWith(repoRoot + "/") && targetPath !== repoRoot) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// 操作対象が.wt/配下なら許可
if (targetPath.includes("/.wt/")) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// worktree内なら許可
const gitDir = await runSafe(["git", "rev-parse", "--git-dir"], { cwd });
if (gitDir?.includes(".git/worktrees")) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// mainブランチでなければ許可
const branch = await runSafe(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
if (branch !== "main" && branch !== "master") {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const reason =
  "メインリポジトリのmainブランチでのファイル変更はブロックされています。worktreeを作成して作業してください。";

console.log(
  JSON.stringify({
    permission: "deny",
    user_message: reason,
    agent_message: reason,
  }),
);
