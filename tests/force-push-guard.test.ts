// force-push-guard の判定ロジックの回帰テスト。
// `bun test` でリポジトリルートから実行する。
//
// 主に固定したいのは次の2点。
//   1. --force / -f / --force-with-lease / +refspec を含む git push をブロックすること
//   2. 通常の git push を誤ってブロックしないこと
//
// deny パターンは prefix マッチのため、`&&` で区切った別コマンド側にフラグが
// あるケースは実装上検出されない（フォースフラグ検出は git push を含むセグメント
// 内 `[^;&|]*` に限定しているため）。これは実装の現状に合わせて検証する。

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const hookPath = join(
  import.meta.dir,
  "..",
  "dot_claude/hooks/executable_force-push-guard.ts",
);

// hook 本体を実行して permissionDecision を取り出す
function runHook(command: string): {
  decision: string | null;
  reason: string | null;
} {
  const stdout = execFileSync("bun", [hookPath], {
    input: JSON.stringify({ cwd: "/tmp", tool_input: { command } }),
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

describe("force push をブロックする", () => {
  test.each([
    ["--force", "git push --force origin feat/x"],
    ["-f", "git push -f"],
    ["--force-with-lease", "git push --force-with-lease origin feat/x"],
    ["+refspec", "git push origin +feat/x"],
  ])("%s", (_name, command) => {
    const { decision, reason } = runHook(command);
    expect(decision).toBe("deny");
    expect(reason).not.toBe("");
    expect(reason).not.toBeNull();
  });
});

describe("通常の git push は許可する", () => {
  test.each([
    ["フラグなし", "git push"],
    ["-u", "git push -u origin feat/x"],
    ["push 以外のコマンド", "git status"],
  ])("%s", (_name, command) => {
    expect(runHook(command).decision).toBeNull();
  });
});

describe("&& の後ろにだけ force 相当の文字列がある場合", () => {
  test("git push を含むセグメント外なので検出されない（実装の現状）", () => {
    // フォースフラグ検出は `git push[^;&|]*` に限定されており、`&&` を越えて
    // 後続コマンドの `-f` までは見ない。よってこのコマンドは許可される。
    expect(runHook("git push origin feat/x && echo -f").decision).toBeNull();
  });
});
