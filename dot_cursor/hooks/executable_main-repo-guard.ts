#!/usr/bin/env bun
// preToolUse hook: メインリポジトリ（非worktree）のmainブランチでファイル変更をブロック

import { dirname, isAbsolute, resolve } from "node:path";

import { readInput, runSafe } from "./lib.ts";

type ToolInput = {
  file_path?: string;
  path?: string;
  target_file?: string;
  old_file_path?: string;
  target_notebook?: string;
};

type PreToolUseInput = {
  file_path?: string;
  tool_input?: ToolInput;
  cwd?: string;
};

const input = await readInput<PreToolUseInput>();

const rawPath =
  input.file_path ??
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

// ユーザーフックは ~/.cursor/ から実行されるため、git 判定は操作対象パス基準で行う
const resolveCwd = input.cwd ?? process.cwd();
const targetPath = isAbsolute(rawPath) ? rawPath : resolve(resolveCwd, rawPath);
const gitCwd = dirname(targetPath);

const repoRoot = await runSafe(["git", "-C", gitCwd, "rev-parse", "--show-toplevel"]);
if (!repoRoot) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}
if (!targetPath.startsWith(repoRoot + "/") && targetPath !== repoRoot) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// 操作対象が.wt/配下なら許可
if (targetPath.includes("/.wt/")) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// worktree内なら許可
const gitDir = await runSafe(["git", "-C", gitCwd, "rev-parse", "--git-dir"]);
if (gitDir?.includes(".git/worktrees")) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// mainブランチでなければ許可
const branch = await runSafe(["git", "-C", gitCwd, "rev-parse", "--abbrev-ref", "HEAD"]);
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
