#!/usr/bin/env bun
// PreToolUse hook: 実行コマンドと引数に基づいて危険な Bash 操作をブロック。
import { readInput } from "./lib.ts";
import { checkShellPolicy } from "./shell-policy-guard-lib.ts";

const input = await readInput<{ tool_input?: { command?: string } }>();
const reason = checkShellPolicy(input.tool_input?.command ?? "");
if (reason) console.log(JSON.stringify({ decision: "block", reason }));
