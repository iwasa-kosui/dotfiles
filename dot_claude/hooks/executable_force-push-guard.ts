#!/usr/bin/env bun
// PreToolUse hook: git push --force / --force-with-lease / -f をブロック
// deny パターンは prefix マッチのため、フラグが引数の後ろに来るケースをすり抜ける。
// このフックでコマンド全体を検査し、位置に関係なくブロックする。

import { readInput } from "./lib.ts";

const input = await readInput<{ tool_input?: { command?: string } }>();
const command = input.tool_input?.command ?? "";

if (!/\bgit\s+push\b/.test(command)) {
  process.exit(0);
}

// git push を含むセグメント内で force フラグを検出（&& や ; の後の別コマンドを誤検出しない）
const forceFlag = /\bgit\s+push\b[^;&|]*(--force-with-lease|--force\b|-f\b)/;
const forceRefspec = /\bgit\s+push\s+\S+\s+\+/;

if (!forceFlag.test(command) && !forceRefspec.test(command)) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason:
      "force push（--force, --force-with-lease, -f, +refspec）は禁止されています。履歴の書き換えではなく、新しいコミットで対応してください。",
  }),
);
