// pr-delegation-guard の判定ロジックの回帰テスト。
// `bun test` でリポジトリルートから実行する。
//
// 主に固定したいのは次の2点。
//   1. メインの会話からの gh による PR 作成・更新 / Ready 化 / merge / コメント投稿をブロックすること
//   2. agent-pr（commit / publish / push）、feature ブランチへの push、読み取り専用の gh コマンド、
//      サブエージェント内の実行は許可すること
// 保護ブランチ宛の push は protected-branch-push-guard.test.ts で固定する。

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import {
  findBlockedPrOperation,
  isMainConversation,
} from "../dot_claude/hooks/pr-delegation-guard-lib.ts";

// pr-delegation-guard は executable_bash-guard.ts に統合済み。
// agent_id の有無で deny / allow が切り替わることを見るテストなので agent_id は変更しない。
const hookPath = join(
  import.meta.dir,
  "..",
  "dot_claude/hooks/executable_bash-guard.ts",
);

// hook 本体を実行して permissionDecision を取り出す
function runHook(input: Record<string, unknown>): string | null {
  const stdout = execFileSync("bun", [hookPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  if (stdout.trim() === "") return null;
  return (
    (
      JSON.parse(stdout) as {
        hookSpecificOutput?: { permissionDecision?: string };
      }
    ).hookSpecificOutput?.permissionDecision ?? null
  );
}

function reasonOf(input: Record<string, unknown>): string | null {
  const stdout = execFileSync("bun", [hookPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  if (stdout.trim() === "") return null;
  return (
    (
      JSON.parse(stdout) as {
        hookSpecificOutput?: { permissionDecisionReason?: string };
      }
    ).hookSpecificOutput?.permissionDecisionReason ?? null
  );
}

describe("PR操作をブロックする", () => {
  test.each([
    ["gh pr create", "gh pr create --draft --title x"],
    ["gh pr edit", "gh pr edit 164 --add-label x"],
    ["gh pr ready", "gh pr ready 164"],
    ["gh pr merge", "gh pr merge 164 --squash"],
    ["gh pr comment", 'gh pr comment 164 --body "x"'],
    ["gh pr review", "gh pr review 164 --approve"],
    ["gh issue comment", 'gh issue comment 10 --body "x"'],
    [
      "gh api -X POST でコメント作成",
      "gh api -X POST repos/o/r/pulls/1/comments -f body=x",
    ],
    [
      "gh api --method PATCH で review comment 更新",
      "gh api --method PATCH repos/o/r/pulls/comments/1 -f body=x",
    ],
    [
      "gh api --method DELETE",
      "gh api --method DELETE repos/o/r/issues/1/comments/2",
    ],
    [
      "gh api メソッド未指定 + フィールドあり",
      "gh api repos/o/r/issues/1/comments -f body=x",
    ],
  ])("%s", (_name, command) => {
    expect(findBlockedPrOperation(command)).toBeDefined();
  });
});

describe("PR操作以外はブロックしない", () => {
  test.each([
    ["agent-pr context", "agent-pr context"],
    ["agent-pr commit", "agent-pr commit --message-file /tmp/msg -- a.ts"],
    [
      "agent-pr publish",
      "agent-pr publish --title x --body-file /tmp/body.md",
    ],
    ["agent-pr push", "agent-pr push"],
    ["git push", "git push"],
    ["git push origin HEAD", "git push origin HEAD"],
    ["git -C を挟む push", "git -C /tmp/wt push"],
    ["cd && git push", "cd /tmp/wt && git push -u origin feat/x"],
    ["pr-autofix collect", "pr-autofix collect"],
    ["gh pr view", "gh pr view 164 --json state"],
    ["gh pr list", "gh pr list"],
    ["gh pr diff", "gh pr diff 164"],
    ["gh pr checks", "gh pr checks 164"],
    [
      "gh api メソッド未指定・フィールドなしの読み取り",
      "gh api repos/o/r/pulls/1/comments",
    ],
    ["gh api -X GET", "gh api -X GET repos/o/r/pulls/1/reviews"],
    ["gh run view", "gh run view --log-failed"],
    ["git status", "git status"],
    ["git fetch", "git fetch origin"],
    ["git log", "git log --oneline"],
    ["bun test", "bun test"],
  ])("%s", (_name, command) => {
    expect(findBlockedPrOperation(command)).toBeUndefined();
  });
});

describe("isMainConversation", () => {
  test.each([
    ["キーが無い", {}, true],
    ["空文字列", { agent_id: "" }, true],
    ["空白のみ", { agent_id: "   " }, true],
    ["null", { agent_id: null }, true],
    ["サブエージェントのID", { agent_id: "a109396390d6b0cb2" }, false],
  ])("%s", (_name, input, expected) => {
    expect(isMainConversation(input)).toBe(expected);
  });
});

describe("hook 本体", () => {
  test("agent_id が空文字列の gh pr create はブロックする", () => {
    expect(
      runHook({
        agent_id: "",
        tool_input: { command: "gh pr create --draft" },
      }),
    ).toBe("deny");
  });

  test("サブエージェント内の gh pr create は許可する", () => {
    expect(
      runHook({
        agent_id: "a109396390d6b0cb2",
        tool_input: { command: "gh pr create --draft --title x" },
      }),
    ).toBeNull();
  });

  test("gh pr view は許可する", () => {
    expect(
      runHook({ tool_input: { command: "gh pr view 164" } }),
    ).toBeNull();
  });

  test.each([
    ["agent-pr push", "agent-pr push"],
    ["agent-pr commit", "agent-pr commit --message-file /tmp/msg -- a.ts"],
    ["agent-pr publish", "agent-pr publish --title x --body-file /tmp/body.md"],
    ["feature ブランチへの git push", "git push -u origin feat/x"],
  ])("メインの会話からの %s は許可する", (_name, command) => {
    expect(runHook({ cwd: "/tmp", tool_input: { command } })).toBeNull();
  });

  test("deny の reason に agent-pr publish と pr-autofix スキルの案内が含まれる", () => {
    const reason = reasonOf({
      tool_input: { command: "gh pr create --draft" },
    });
    expect(reason).toContain("agent-pr publish");
    expect(reason).toContain("pr-autofix スキル");
    expect(reason).toContain("承認");
  });

  test("deny の reason に廃止したサブエージェントを含めない", () => {
    const reason = reasonOf({
      tool_input: { command: "gh pr merge 164 --squash" },
    });
    expect(reason).not.toContain("commit-pusher");
    expect(reason).not.toContain("pr-shipper");
    expect(reason).not.toContain("pr-runner");
  });
});
