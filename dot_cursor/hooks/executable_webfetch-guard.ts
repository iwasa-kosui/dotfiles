#!/usr/bin/env bun
// preToolUse hook: WebFetch の URL を検証し、内部ネットワークへのアクセスをブロック

import { readInput } from "./lib.ts";

type PreToolUseInput = {
  tool_input?: { url?: string };
  url?: string;
};

const input = await readInput<PreToolUseInput>();
const url = input.tool_input?.url ?? input.url ?? "";

if (!url) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

let host: string;
try {
  host = new URL(url).hostname;
} catch {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const localhost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
if (localhost.includes(host)) {
  const reason = `ローカルホストへのアクセスはブロックされています: ${host}`;
  console.log(
    JSON.stringify({
      permission: "deny",
      user_message: reason,
      agent_message: reason,
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
  const reason = `プライベートネットワークへのアクセスはブロックされています: ${host}`;
  console.log(
    JSON.stringify({
      permission: "deny",
      user_message: reason,
      agent_message: reason,
    }),
  );
  process.exit(0);
}

if (/\.(internal|local|corp)$/.test(host)) {
  const reason = `内部ドメインへのアクセスはブロックされています: ${host}`;
  console.log(
    JSON.stringify({
      permission: "deny",
      user_message: reason,
      agent_message: reason,
    }),
  );
  process.exit(0);
}

console.log(JSON.stringify({ permission: "allow" }));
