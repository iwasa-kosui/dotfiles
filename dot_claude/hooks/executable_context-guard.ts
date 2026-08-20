#!/usr/bin/env bun
// UserPromptSubmit hook: 現在のコンテキスト量を transcript から算出し、閾値を超えていたら知らせる

import { readInput } from "./lib.ts";

// UserPromptSubmit の入力にコンテキスト使用量は含まれないため、transcript の
// 直近の assistant エントリの usage から算出する。

// autoCompactEnabled を false にしているため、上限に達したときに履歴を圧縮して逃がす仕組みが無い。
// 5万は導出値ではなく運用上の指定値。早めに知らせて handoff の判断をこちらに寄せる意図で、
// 大きめのファイルを数件読むだけで到達する。頻度が煩わしければこの値を上げる。
const WARN_TOKENS = 50_000;

// transcript は長時間セッションで数十MBに達する。直近の usage を拾うには末尾だけで足りる。
const TAIL_BYTES = 2_000_000;

type Entry = {
  type?: string;
  isSidechain?: boolean;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
};

async function currentContextTokens(path: string): Promise<number | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;

  const text = await file.slice(Math.max(0, file.size - TAIL_BYTES)).text();
  const lines = text.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let entry: Entry;
    try {
      entry = JSON.parse(line) as Entry;
    } catch {
      // 末尾から読んでいるため先頭行は途中で切れている。壊れた行は飛ばす
      continue;
    }
    // サブエージェントは別のコンテキストウィンドウを持つので親の量には含めない
    if (entry.type !== "assistant" || entry.isSidechain) continue;
    const usage = entry.message?.usage;
    if (!usage) continue;
    return (
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0)
    );
  }
  return null;
}

async function main(): Promise<void> {
  const input = await readInput<{ transcript_path?: string }>();
  if (!input.transcript_path) return;

  const tokens = await currentContextTokens(input.transcript_path);
  if (tokens === null || tokens < WARN_TOKENS) return;

  const k = Math.round(tokens / 1000);
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext:
          `現在のコンテキストは約 ${k}k トークンです。` +
          `ツール実行のたびにこの全量を読み直すため、1往復あたりの消費はこの量に比例します。` +
          `自動圧縮は無効にしてあるので、上限に達しても要約に逃げられません。` +
          `作業を区切れる段階なら handoff スキルで結論を書き出し、新しいセッションで続けてください。` +
          `区切れない場合はこのまま進めてかまいませんが、ユーザーに区切りの可否を確認してください。`,
      },
    }),
  );
}

try {
  await main();
} catch {
  // フックの失敗でプロンプトの送信を止めない
}
