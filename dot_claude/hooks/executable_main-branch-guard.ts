#!/usr/bin/env bun
// PreToolUse hook: 保護ブランチ（main/master/develop）で履歴・状態を変更するgitコマンドをブロック

import { readInput } from "./lib.ts";
import { checkMainBranchGuard } from "./branch-guard-lib.ts";
import {
  normalizeShellCommand,
  resolveShellHookCwd,
  type ShellHookInput,
} from "./shell-hook-lib.ts";

const input = await readInput<ShellHookInput>();
const command = normalizeShellCommand(input);
if (!command) {
  process.exit(0);
}

const result = await checkMainBranchGuard(command, resolveShellHookCwd(input));
if (result.action === "allow") {
  process.exit(0);
}

// PreToolUse はトップレベルの decision ではなく hookSpecificOutput.permissionDecision を読む。
// 何も出力せず終了した場合は通常のパーミッションフローに委ねられる。
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: result.reason,
    },
  }),
);
