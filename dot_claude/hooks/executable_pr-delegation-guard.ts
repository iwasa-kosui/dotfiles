#!/usr/bin/env bun
// PreToolUse hook: メインの会話から commit / push / PR 作成・更新 / コメント投稿を
// 直接実行しようとした場合にブロックし、pr / pr-autofix スキル経由に誘導する

import { readInput } from "./lib.ts";
import {
  findBlockedPrOperation,
  isMainConversation,
  reasonFor,
} from "./pr-delegation-guard-lib.ts";
import { normalizeShellCommand, type ShellHookInput } from "./shell-hook-lib.ts";

const input = await readInput<ShellHookInput & { agent_id?: unknown }>();
if (!isMainConversation(input)) {
  process.exit(0);
}

const command = normalizeShellCommand(input);
if (!command) {
  process.exit(0);
}

const blocked = findBlockedPrOperation(command);
if (!blocked) {
  process.exit(0);
}

// PreToolUse はトップレベルの decision ではなく hookSpecificOutput.permissionDecision を読む。
// 何も出力せず終了した場合は通常のパーミッションフローに委ねられる。
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reasonFor(blocked.name),
    },
  }),
);
