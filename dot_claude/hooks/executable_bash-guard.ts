#!/usr/bin/env bun
// PreToolUse hook: Bash 実行前に走る6つのガードを1プロセスに集約したディスパッチャ。
//
// 以前は main-branch-guard / force-push-guard / commit-message-guard /
// gh-comment-format-guard / lint-outgoing-body / pr-delegation-guard が
// それぞれ独立した executable_*.ts として settings.json に登録され、
// Bash を叩くたびに bun プロセスが6つ起動していた。判定ロジックは各
// *-guard-lib.ts に切り出し済みなので、ここでは stdin を1回だけ読み取って
// GuardInput を組み立て、bash-guard-lib.ts の guards 配列を順に評価するだけにし、
// hook を1件・bun 起動を1回に減らす。
//
// deny が出た時点で後続のガードは実行しない
// （lint-outgoing-body は textlint プロセスを起動するため、無駄な起動を避ける意味がある）。

import { guards } from "./bash-guard-lib.ts";
import { readInput } from "./lib.ts";
import {
  normalizeShellCommand,
  resolveShellHookCwd,
  type ShellHookInput,
} from "./shell-hook-lib.ts";

const input = await readInput<ShellHookInput & { agent_id?: unknown }>();

const command = input.command ?? input.tool_input?.command ?? "";
if (!command) {
  process.exit(0);
}

const guardInput = {
  command,
  normalizedCommand: normalizeShellCommand(input),
  cwd: resolveShellHookCwd(input),
  agentId: input.agent_id,
};

for (const guard of guards) {
  const result = await guard.check(guardInput);
  if (result.action === "deny") {
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
    process.exit(0);
  }
}

process.exit(0);
