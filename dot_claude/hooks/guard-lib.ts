// Bash 系 PreToolUse hook の判定ロジックが共通で使う型とヘルパー。
// 各 guard lib の check 関数はこの GuardInput を受け取り GuardResult を返す。

export type GuardResult = { action: "allow" } | { action: "deny"; reason: string };

export type GuardInput = {
  /**
   * 生のコマンド文字列。改行を保持する。
   * ヒアドキュメントの本文や、コメント body の行頭を見る判定はこちらを使う。
   */
  readonly command: string;
  /**
   * 連続する空白を1つに潰したコマンド文字列。
   * コマンド名とサブコマンドのパターンマッチはこちらを使う。
   */
  readonly normalizedCommand: string;
  readonly cwd: string;
  /** PreToolUse の stdin の agent_id。サブエージェント内でのみ渡る */
  readonly agentId: unknown;
};

export const allow: GuardResult = { action: "allow" };

export function deny(reason: string): GuardResult {
  return { action: "deny", reason };
}

export type Guard = {
  readonly name: string;
  readonly check: (input: GuardInput) => GuardResult | Promise<GuardResult>;
};
