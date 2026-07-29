#!/usr/bin/env bun
// PreToolUse hook: WebFetchのURLを検証し、内部ネットワークへのアクセスをブロック

import { readInput } from "./lib.ts";

// PreToolUse はトップレベルの decision ではなく hookSpecificOutput.permissionDecision を読む。
// 何も出力せず終了した場合は通常のパーミッションフローに委ねられる。
function deny(reason: string): never {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const input = await readInput<{ tool_input?: { url?: string } }>();
const url = input.tool_input?.url ?? "";

if (!url) {
  process.exit(0);
}

let host: string;
try {
  host = new URL(url).hostname;
} catch {
  process.exit(0);
}

const localhost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
if (localhost.includes(host)) {
  deny(`ローカルホストへのアクセスはブロックされています: ${host}`);
}

const privatePatterns = [
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
];
if (privatePatterns.some((p) => p.test(host))) {
  deny(`プライベートネットワークへのアクセスはブロックされています: ${host}`);
}

if (/\.(internal|local|corp)$/.test(host)) {
  deny(`内部ドメインへのアクセスはブロックされています: ${host}`);
}
