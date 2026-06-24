#!/usr/bin/env bun
// PreToolUse hook: gh api で PR コメント投稿・更新時に
// 「🤖 Claude Code より:」プレフィックスを強制する

import { readInput } from "./lib.ts";

const input = await readInput<{ tool_input?: { command?: string } }>();
const command = input.tool_input?.command ?? "";

// gh api で PR コメント系エンドポイントへの POST/PATCH を検出
// - pulls/comments (review comment reply, update)
// - pulls/*/comments (new review comment)
// - pulls/*/reviews (review submission)
// - issues/*/comments (issue/PR general comment)
const commentEndpoint =
  /\bgh\s+api\b.*\b(pulls\/\d*\/?comments|pulls\/\d+\/reviews|issues\/\d+\/comments)\b/;

if (!commentEndpoint.test(command)) {
  process.exit(0);
}

// DELETE は対象外
if (/--method\s+DELETE\b|-X\s+DELETE\b/.test(command)) {
  process.exit(0);
}

// -f body= の値を抽出（シングルクォート・ダブルクォート・クォートなし）
const bodyMatch = command.match(
  /-f\s+body=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/,
);

if (!bodyMatch) {
  // body パラメータがない場合はスキップ（GET リクエスト等）
  process.exit(0);
}

const body = bodyMatch[1] ?? bodyMatch[2] ?? bodyMatch[3] ?? "";

if (body.startsWith("🤖 Claude Code より:")) {
  process.exit(0);
}

// body がシェル変数・コマンド置換の場合、展開前の文字列なので
// コマンド全体にプレフィックスが含まれているかで判定する
if (/^\$/.test(body) && command.includes("🤖 Claude Code より:")) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason:
      "GitHub PR コメントの本文は「🤖 Claude Code より:」で始める必要があります（github-review.md ルール）。body の先頭にプレフィックスを追加してください。",
  }),
);
