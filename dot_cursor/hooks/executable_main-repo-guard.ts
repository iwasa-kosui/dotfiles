#!/usr/bin/env bun
// preToolUse hook: メインリポジトリ（非worktree）の保護ブランチでファイル変更をブロック

import { isAbsolute, resolve } from "node:path";

import { readInput } from "./lib.ts";
import {
  allowResponse,
  checkProtectedMainRepo,
  checkProtectedMainRepoCwd,
  denyResponse,
  WRITE_TOOL_NAMES,
} from "./repo-guard-lib.ts";

type ToolInput = {
  file_path?: string;
  path?: string;
  target_file?: string;
  old_file_path?: string;
  target_notebook?: string;
  notebook_path?: string;
};

type PreToolUseInput = {
  tool_name?: string;
  file_path?: string;
  tool_input?: ToolInput;
  cwd?: string;
};

const input = await readInput<PreToolUseInput>();
const resolveCwd = input.cwd ?? process.cwd();

const rawPath =
  input.file_path ??
  input.tool_input?.file_path ??
  input.tool_input?.path ??
  input.tool_input?.target_file ??
  input.tool_input?.old_file_path ??
  input.tool_input?.target_notebook ??
  input.tool_input?.notebook_path ??
  "";

if (!rawPath) {
  // Write系ツールでパス未指定の場合は cwd 基準でブロック
  if (input.tool_name && WRITE_TOOL_NAMES.has(input.tool_name)) {
    const result = await checkProtectedMainRepoCwd(resolveCwd);
    if (result.action === "deny") {
      denyResponse(result.reason);
      process.exit(0);
    }
  }
  allowResponse();
  process.exit(0);
}

const targetPath = isAbsolute(rawPath) ? rawPath : resolve(resolveCwd, rawPath);
const result = await checkProtectedMainRepo(targetPath, resolveCwd);
if (result.action === "deny") {
  denyResponse(result.reason);
  process.exit(0);
}

allowResponse();
