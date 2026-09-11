// メインの会話から直接実行された PR 操作（commit / push / PR 作成・更新 / コメント投稿）を
// 判定するロジック。hook 本体から切り離してテストできるようにしている。
//
// PR 操作は pr / pr-autofix スキル経由でサブエージェントに実行させる方針のため、
// メインの会話から agent-pr / gh / git push が直接呼ばれたら拒否する。

import { GIT_PREFIX } from "./shell-hook-lib.ts";

export type BlockedPrOperation = {
  readonly name: string;
  readonly pattern: RegExp;
};

const blockedOperations: BlockedPrOperation[] = [
  { name: "agent-pr commit", pattern: /\bagent-pr\s+commit\b/ },
  { name: "agent-pr publish", pattern: /\bagent-pr\s+publish\b/ },
  { name: "gh pr create", pattern: /\bgh\s+pr\s+create\b/ },
  { name: "gh pr edit", pattern: /\bgh\s+pr\s+edit\b/ },
  { name: "gh pr ready", pattern: /\bgh\s+pr\s+ready\b/ },
  { name: "gh pr merge", pattern: /\bgh\s+pr\s+merge\b/ },
  { name: "gh pr comment", pattern: /\bgh\s+pr\s+comment\b/ },
  { name: "gh pr review", pattern: /\bgh\s+pr\s+review\b/ },
  { name: "gh issue comment", pattern: /\bgh\s+issue\s+comment\b/ },
  { name: "git push", pattern: new RegExp(`${GIT_PREFIX.source}push\\b`) },
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

PR 操作はスキル経由でサブエージェントに実行させること。
- コミット / push / PR の作成・更新 → pr スキルを起動する
- CI 失敗とレビュー指摘の修正 / レビューコメントへの返信 → pr-autofix スキルを起動する

どちらのスキルも frontmatter の context: fork で専用のサブエージェントにフォークされる。サブエージェント内ではこの hook は発火しないため、同じコマンドがそのまま実行できる。`;
}
