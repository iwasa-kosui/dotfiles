// PreToolUse hook: AWS CLI の直接実行をブロックする判定ロジック。
// エージェントが AWS を直接操作するのではなく、ユーザーが aws-vault 経由で
// 実行できる手順として書き出すことを強制する。

import { allow, deny, type GuardInput, type GuardResult } from "./guard-lib.ts";

const REASON = `AWS CLI の実行は禁止されています。エージェントが AWS を直接操作するのではなく、ユーザーが自分で実行できる作業手順として書き出してください。

手順に書くコマンドは aws-vault を前提にすること。

- 実行コマンドは \`aws-vault exec <profile> -- aws ...\` の形式で書く。素の \`aws\` や \`AWS_PROFILE=\` に依存した手順は書かない
- プロファイル名を手順の中で明示する。どのアカウントに対する操作か確定できない場合はユーザーに確認する
- \`--region\` を明示する。既定リージョンに依存した手順は書かない
- 参照系（describe / list / get）と変更系を節で分け、変更系には事前確認の手順と実行後の確認方法を添える
- 破壊的な操作は、何が変わるか・元に戻せるかを手順の中に書く

\`aws-vault exec\` を付けた形に書き換えて再実行しても、この hook は同じく deny する。実行するのはユーザーであって、エージェントではない。

ファイル名やディレクトリ名に aws を含むだけで誤検出した場合は、Read / Grep / Glob ツールを使うか、パスをクォートで囲むこと。`;

// クォートで囲まれた部分の aws は引数の値であり、コマンドとしての aws ではない。
// 例: git commit -m "feat(aws): ..." / echo 'aws s3 ls'
const QUOTED = /"[^"]*"|'[^']*'/g;

// 単語として裸で現れる aws を拾う。normalizeShellCommand が改行を潰すため、
// コマンド名の位置（行頭・パイプの直後など）を厳密に特定できない。そのため
// 「起点」ではなく「除外条件」で精度を出す設計にしている。
//   - 後続が `-` `\w` の場合を除外: aws-vault list や awscli をブロックしない
//   - 前が `.` の場合を除外: ~/.aws/config をブロックしない
//   - 後続が `/` の場合を除外: cd aws/lambda や /aws/lambda/fn のような
//     ロググループ名をブロックしない
//   - 前後が `:` の場合を除外: arn:aws:iam::... をブロックしない
//   - 前が `/` の場合は除外しない: /usr/local/bin/aws のようなフルパス実行を拾う
//   - 大文字小文字は区別する: AWS_PROFILE= を誤検出せず、コマンド名としての
//     aws は小文字であるため
const AWS_CLI = /(?<![\w.\-=:])aws(?![\w.\-/=:])/;

export function checkAwsCli(input: GuardInput): GuardResult {
  // パターンマッチのみなので正規化済みのコマンドを使う。
  const command = input.normalizedCommand.replace(QUOTED, " ");

  if (!AWS_CLI.test(command)) {
    return allow;
  }

  return deny(REASON);
}
