// aws-cli-guard の判定ロジックの回帰テスト。
// `bun test` でリポジトリルートから実行する。
//
// 主に固定したいのは次の2点。
//   1. 素の aws コマンドはブロックすること。aws-vault 経由でも aws 自体が
//      現れる限りブロックすること（方針の核心: 実行するのはユーザーであって
//      エージェントではない。aws-vault を付けて再実行してもすり抜けない）
//   2. aws-vault のサブコマンドや ~/.aws/ のようなパス、arn:aws:... のような
//      無関係な出現を誤ってブロックしないこと

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const hookPath = join(
  import.meta.dir,
  "..",
  "dot_claude/hooks/executable_bash-guard.ts",
);

// hook 本体を実行して permissionDecision を取り出す
function runHook(command: string): {
  decision: string | null;
  reason: string | null;
} {
  const stdout = execFileSync("bun", [hookPath], {
    // agent_id を渡し pr-delegation-guard などの他のガードを allow にすることで、
    // 検査対象の aws-cli-guard 単体の挙動だけを見る。
    input: JSON.stringify({
      cwd: "/tmp",
      agent_id: "test-subagent",
      tool_input: { command },
    }),
    encoding: "utf8",
  });
  if (stdout.trim() === "") return { decision: null, reason: null };
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput?: {
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
  };
  return {
    decision: parsed.hookSpecificOutput?.permissionDecision ?? null,
    reason: parsed.hookSpecificOutput?.permissionDecisionReason ?? null,
  };
}

describe("AWS CLI の直接実行をブロックする", () => {
  test.each([
    ["aws s3 ls", "aws s3 ls"],
    ["aws sts get-caller-identity", "aws sts get-caller-identity"],
    // aws-vault を付けて再実行しても aws 自体が現れる限りブロックする（方針の核心）
    ["aws-vault exec 経由でも aws 自体はブロックする", "aws-vault exec prod -- aws s3 ls"],
    ["AWS_PROFILE=prod aws ...", "AWS_PROFILE=prod aws ec2 describe-instances"],
    ["パイプの後段", "cat data.json | aws s3 cp - s3://bucket/key"],
    ["sudo 経由", "sudo aws s3 ls"],
    ["フルパス実行", "/usr/local/bin/aws s3 ls"],
    // /aws/lambda/my-fn ではなく tail の直前の aws コマンドを拾う
    ["ロググループ名ではなくコマンドの aws を拾う", "cd /tmp && aws logs tail /aws/lambda/my-fn"],
    // normalizeShellCommand が改行を潰しても検出できることの確認
    ["複数行コマンド", "cd /tmp\naws s3 ls"],
  ])("%s", (_name, command) => {
    const { decision, reason } = runHook(command);
    expect(decision).toBe("deny");
    expect(reason).not.toBe("");
    expect(reason).not.toBeNull();
  });
});

describe("AWS CLI に関係しないコマンドは許可する", () => {
  test.each([
    ["aws-vault list", "aws-vault list"],
    ["aws-vault login prod", "aws-vault login prod"],
    ["~/.aws/config の参照", "cat ~/.aws/config"],
    ["~/.aws の参照", "ls ~/.aws"],
    ["無関係な対照", "git commit -F /tmp/msg"],
    ["クォート内は拾わない", "echo 'aws s3 ls'"],
    ["awscli というパッケージ名", "brew install awscli"],
    ["aws/lambda というディレクトリ名", "cd aws/lambda"],
    ["AWS_PROFILE という文字列の検索", "rg AWS_PROFILE ."],
    ["arn:aws:iam::... の出力", "echo arn:aws:iam::123456789012:role/MyRole"],
  ])("%s", (_name, command) => {
    expect(runHook(command).decision).toBeNull();
  });
});

describe("deny の reason に aws-vault を使った手順の指示が含まれる", () => {
  test("フィードバック文面が届いていることの確認", () => {
    const { reason } = runHook("aws s3 ls");
    expect(reason).toContain("aws-vault");
  });
});
