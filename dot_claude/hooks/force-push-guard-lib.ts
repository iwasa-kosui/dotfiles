// PreToolUse hook: git push --force / --force-with-lease / -f をブロックする判定ロジック。
// deny パターンは prefix マッチのため、フラグが引数の後ろに来るケースをすり抜ける。
// このロジックでコマンド全体を検査し、位置に関係なくブロックする。

import { allow, deny, type GuardInput, type GuardResult } from "./guard-lib.ts";

const REASON =
  "force push（--force, --force-with-lease, -f, +refspec）は禁止されています。履歴の書き換えではなく、新しいコミットで対応してください。";

export function checkForcePush(input: GuardInput): GuardResult {
  // パターンマッチのみなので正規化済みのコマンドを使う。
  const command = input.normalizedCommand;

  if (!/\bgit\s+push\b/.test(command)) {
    return allow;
  }

  // git push を含むセグメント内で force フラグを検出（&& や ; の後の別コマンドを誤検出しない）
  const forceFlag = /\bgit\s+push\b[^;&|]*(--force-with-lease|--force\b|-f\b)/;
  const forceRefspec = /\bgit\s+push\s+\S+\s+\+/;

  if (!forceFlag.test(command) && !forceRefspec.test(command)) {
    return allow;
  }

  return deny(REASON);
}
