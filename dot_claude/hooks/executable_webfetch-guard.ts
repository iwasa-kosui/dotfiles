#!/usr/bin/env bun
// PreToolUse hook: WebFetchのURLを検証し、内部ネットワークへのアクセスをブロック

import { readInput } from "./lib.ts";

const input = await readInput<{ tool_input?: { url?: string } }>();
const url = input.tool_input?.url ?? "";

if (!url) {
  console.log(JSON.stringify({ decision: "allow" }));
  process.exit(0);
}

let host: string;
try {
  host = new URL(url).hostname;
} catch {
  console.log(JSON.stringify({ decision: "allow" }));
  process.exit(0);
}

const localhost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
if (localhost.includes(host)) {
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `ローカルホストへのアクセスはブロックされています: ${host}`,
    }),
  );
  process.exit(0);
}

const privatePatterns = [
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
];
if (privatePatterns.some((p) => p.test(host))) {
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `プライベートネットワークへのアクセスはブロックされています: ${host}`,
    }),
  );
  process.exit(0);
}

if (/\.(internal|local|corp)$/.test(host)) {
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `内部ドメインへのアクセスはブロックされています: ${host}`,
    }),
  );
  process.exit(0);
}

console.log(JSON.stringify({ decision: "allow" }));
