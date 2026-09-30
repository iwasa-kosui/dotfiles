// メインの会話から直接実行された gh 経由の PR 操作（PR 作成・更新 / Ready 化 / merge /
// コメント投稿）を判定するロジック。hook 本体から切り離してテストできるようにしている。
//
// commit / push / Draft PR の作成は agent-pr（commit / publish）経由でメインが直接行う。
// それ以外の gh による PR 操作（Ready 化・merge・コメント投稿など）は承認が必要なため、
// メインの会話から直接呼ばれたら拒否する。

import { allow, deny, type GuardInput, type GuardResult } from "./guard-lib.ts";

export type BlockedPrOperation = {
  readonly name: string;
  readonly pattern: RegExp;
};

const blockedOperations: BlockedPrOperation[] = [
  { name: "gh pr create", pattern: /\bgh\s+pr\s+create\b/ },
  { name: "gh pr edit", pattern: /\bgh\s+pr\s+edit\b/ },
  { name: "gh pr ready", pattern: /\bgh\s+pr\s+ready\b/ },
  { name: "gh pr merge", pattern: /\bgh\s+pr\s+merge\b/ },
  { name: "gh pr comment", pattern: /\bgh\s+pr\s+comment\b/ },
  { name: "gh pr review", pattern: /\bgh\s+pr\s+review\b/ },
  { name: "gh issue comment", pattern: /\bgh\s+issue\s+comment\b/ },
];

// gh api のコメント系エンドポイント。gh-comment-format-guard.ts の GH_API_COMMENT と同一。
//   pulls/comments    : review comment の更新
//   pulls/*/comments  : review comment の新規作成・返信
//   pulls/*/reviews   : review の submit
//   issues/*/comments : PR / Issue の通常コメント
const GH_API_COMMENT =
  /\bgh\s+api\b[\s\S]*?\b(?:pulls\/\d*\/?comments|pulls\/\d+\/reviews|issues\/\d+\/comments)\b/;

export function isMutatingGhApiComment(command: string): boolean {
  if (!GH_API_COMMENT.test(command)) {
    return false;
  }

  const methodMatch = command.match(/(?:--method|-X)\s+(\S+)/i);
  if (methodMatch) {
    return !/^(?:GET|HEAD)$/i.test(methodMatch[1]);
  }

  // メソッド未指定の gh api は既定で GET。フィールドを渡したときだけ POST になる
  return /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)\b/.test(command);
}

export function findBlockedPrOperation(
  command: string,
): BlockedPrOperation | undefined {
  const matched = blockedOperations.find(({ pattern }) => pattern.test(command));
  if (matched) {
    return matched;
  }

  if (isMutatingGhApiComment(command)) {
    return { name: "gh api (コメント/レビューの書き込み)", pattern: GH_API_COMMENT };
  }

  return undefined;
}

// PreToolUse の stdin の agent_id はサブエージェント内で発火したときだけ渡る。
// キーが無い・null・空文字列のいずれもメインの会話からの実行として扱う。
export function isMainConversation(input: { agent_id?: unknown }): boolean {
  const agentId = input.agent_id;
  return typeof agentId !== "string" || agentId.trim() === "";
}

export function reasonFor(name: string): string {
  return `メインの会話から PR 操作を直接実行することはできません（検出: ${name}）。

- PR の作成・更新 → agent-pr publish --title <title> --body-file <path> [--base <branch>] を使う
- Ready 化・merge → ユーザーの明示的な承認が必要。承認を得たうえでユーザー自身が実行する
- レビューコメントへの返信 → pr-autofix スキルを起動する

サブエージェント内ではこの hook は発火しないため、pr-autofix スキルの中では同じコマンドがそのまま実行できる。`;
}

export function checkPrDelegation(input: GuardInput): GuardResult {
  if (!isMainConversation({ agent_id: input.agentId })) {
    return allow;
  }

  // パターンマッチのみなので正規化済みのコマンドを使う。
  const blocked = findBlockedPrOperation(input.normalizedCommand);
  if (!blocked) {
    return allow;
  }

  return deny(reasonFor(blocked.name));
}
