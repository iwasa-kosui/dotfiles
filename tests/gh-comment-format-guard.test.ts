// gh-comment-format-guard の判定ロジックの回帰テスト。
// `bun test` でリポジトリルートから実行する。
//
// 主に固定したいのは次の3点。
//   1. 署名行 `> 🤖 Claude Code` 以降の行頭がすべて `>` になっている body を許可すること
//   2. 署名行以降に `>` で始まらない行がある body、および署名行自体がない body を
//      ブロックすること（後者は「対象外で素通し」ではなく deny になるのが実装の現状）
//   3. コメント投稿系コマンドでないもの、GET/DELETE、body を伴わないものは対象外として
//      素通しすること

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// gh-comment-format-guard は executable_bash-guard.ts に統合済み。
const hookPath = join(
  import.meta.dir,
  "..",
  "dot_claude/hooks/executable_bash-guard.ts",
);

// 引用記法の規約を満たす body。署名行以降は空行を含めすべて `>` で始まる
const GOOD_BODY = "> 🤖 Claude Code\n>\n> 修正しました (e4dcbb406)";
// 署名行はあるが、途中に `>` で始まらない行が混ざっている body
const BAD_BODY = "> 🤖 Claude Code\n>\n普通の行\n> 修正しました";

// hook 本体を実行して permissionDecision / reason を取り出す
function runHook(
  command: string,
  cwd = "/tmp",
): { decision: string | null; reason: string | null } {
  const stdout = execFileSync("bun", [hookPath], {
    // agent_id を渡し pr-delegation-guard を allow にすることで、検査対象の
    // gh-comment-format-guard 単体の挙動だけを見る（agent_id が無いと
    // gh pr comment が pr-delegation-guard にも deny される）。
    input: JSON.stringify({
      cwd,
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

describe("引用記法が規約どおりの body は許可する", () => {
  test("gh pr comment --body に署名行以降すべて > の body", () => {
    const { decision } = runHook(`gh pr comment 164 --body '${GOOD_BODY}'`);
    expect(decision).toBeNull();
  });

  test("gh api pulls/comments の -f body= に署名行以降すべて > の body", () => {
    const { decision } = runHook(
      `gh api repos/o/r/pulls/1/comments -f body='${GOOD_BODY}'`,
    );
    expect(decision).toBeNull();
  });
});

describe("引用記法を満たさない body はブロックする", () => {
  test("署名行以降に > で始まらない行がある", () => {
    const { decision, reason } = runHook(
      `gh pr comment 164 --body '${BAD_BODY}'`,
    );
    expect(decision).toBe("deny");
    expect(reason).not.toBeNull();
    expect(reason).not.toBe("");
  });

  test("署名行そのものが body に含まれない（実装上は素通しではなく deny）", () => {
    const { decision, reason } = runHook(
      `gh pr comment 164 --body '普通のコメントです'`,
    );
    expect(decision).toBe("deny");
    expect(reason).not.toBeNull();
    expect(reason).not.toBe("");
  });
});

describe("対象外のコマンドは素通しする", () => {
  test.each([
    ["コメント投稿以外の gh コマンド", "gh pr view 164"],
    ["--method 等を指定しない GET 相当（body を伴わない）", "gh api repos/o/r/pulls/1/comments"],
    ["--method DELETE", "gh api --method DELETE repos/o/r/pulls/comments/123"],
  ])("%s", (_name, command) => {
    expect(runHook(command).decision).toBeNull();
  });
});

describe("body-file / --input 経由のファイルも検査する", () => {
  test("--body-file で相対パス指定、規約どおりの内容は許可する", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-comment-format-guard-"));
    try {
      writeFileSync(join(dir, "good.txt"), GOOD_BODY);
      expect(
        runHook(`gh pr comment 164 --body-file good.txt`, dir).decision,
      ).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--body-file で相対パス指定、規約違反の内容はブロックする", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-comment-format-guard-"));
    try {
      writeFileSync(join(dir, "bad.txt"), BAD_BODY);
      const { decision, reason } = runHook(
        `gh pr comment 164 --body-file bad.txt`,
        dir,
      );
      expect(decision).toBe("deny");
      expect(reason).not.toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("gh api --input で JSON ファイル内の body を検査する", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-comment-format-guard-"));
    try {
      writeFileSync(
        join(dir, "good.json"),
        JSON.stringify({ body: GOOD_BODY }),
      );
      expect(
        runHook(
          `gh api repos/o/r/issues/1/comments --input good.json`,
          dir,
        ).decision,
      ).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
