#!/usr/bin/env bun
// beforeShellExecution hook: gh api で PR コメント投稿時にプレフィックスを強制

import { readInput } from "./lib.ts";

type BeforeShellInput = {
  command?: string;
};

const input = await readInput<BeforeShellInput>();
const command = input.command ?? "";

// gh api で PR コメント系エンドポイントへの POST/PATCH を検出
const commentEndpoint =
  /\bgh\s+api\b.*\b(pulls\/\d*\/?comments|pulls\/\d+\/reviews|issues\/\d+\/comments)\b/;

if (!commentEndpoint.test(command)) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// DELETE は対象外
if (/--method\s+DELETE\b|-X\s+DELETE\b/.test(command)) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// -f body= の値を抽出
const bodyMatch = command.match(
  /-f\s+body=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/,
);

if (!bodyMatch) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const body = bodyMatch[1] ?? bodyMatch[2] ?? bodyMatch[3] ?? "";
const requiredPrefix = "🤖 Claude Code より:";

if (body.startsWith(requiredPrefix)) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

if (/^\$/.test(body) && command.includes(requiredPrefix)) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const reason = `GitHub PR コメントの本文は「${requiredPrefix}」で始める必要があります。body の先頭にプレフィックスを追加してください。`;

console.log(
  JSON.stringify({
    permission: "deny",
    user_message: reason,
    agent_message: reason,
  }),
);
