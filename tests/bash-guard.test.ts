// executable_bash-guard.ts（6つのガードを1プロセスに集約したディスパッチャ）の回帰テスト。
// `bun test` でリポジトリルートから実行する。
//
// 各ガード個別の判定ロジックの回帰は force-push-guard.test.ts / commit-message-guard.test.ts /
// gh-comment-format-guard.test.ts / pr-delegation-guard.test.ts / branch-guard-lib.test.ts に
// 既にある。このファイルで固定したいのはディスパッチャ固有の3点。
//   1. 6つのガードすべてが配線されていること（各ガードが deny する入力を1件ずつ確認する）
//   2. dot_claude/modify_settings.json.tmpl の旧登録順（main-branch → force-push →
//      commit-message → gh-comment-format → lint-outgoing-body → pr-delegation）が
//      維持されていること
//   3. どのガードにも該当しない入力・空のコマンドでは何も出力しないこと

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hookPath = join(
  import.meta.dir,
  "..",
  "dot_claude/hooks/executable_bash-guard.ts",
);

// hook 本体を実行して permissionDecision / reason を取り出す
function runHook(input: Record<string, unknown>): {
  decision: string | null;
  reason: string | null;
} {
  const stdout = execFileSync("bun", [hookPath], {
    input: JSON.stringify(input),
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

describe("6つのガードすべてが配線されている", () => {
  test("main-branch-guard: 保護ブランチでのコミットを拒否する", () => {
    const tempParent = mkdtempSync(join(tmpdir(), "bash-guard-"));
    const mainRepo = join(tempParent, "main-repo");
    try {
      execFileSync("git", ["init", "-b", "main", mainRepo], {
        stdio: "ignore",
      });
      execFileSync(
        "git",
        [
          "-C",
          mainRepo,
          "-c",
          "user.name=Bash Guard Test",
          "-c",
          "user.email=bash-guard@example.invalid",
          "commit",
          "--allow-empty",
          "-m",
          "initial",
        ],
        { stdio: "ignore" },
      );

      const { decision, reason } = runHook({
        cwd: mainRepo,
        tool_input: { command: "git commit -m x" },
      });
      expect(decision).toBe("deny");
      expect(reason).toContain("保護ブランチ");
    } finally {
      rmSync(tempParent, { recursive: true, force: true });
    }
  });

  test("force-push-guard: git push --force を拒否する", () => {
    const { decision, reason } = runHook({
      cwd: "/tmp",
      tool_input: { command: "git push --force origin feat/x" },
    });
    expect(decision).toBe("deny");
    expect(reason).toContain("force push（");
  });

  test("commit-message-guard: @ で始まるコミットメッセージを拒否する", () => {
    const { decision, reason } = runHook({
      cwd: tmpdir(),
      tool_input: { command: "git commit -m @'\nfeat: 要約\n'@" },
    });
    expect(decision).toBe("deny");
    expect(reason).toContain("here-string");
  });

  test("gh-comment-format-guard: 引用記法でない body を拒否する", () => {
    const { decision, reason } = runHook({
      cwd: "/tmp",
      tool_input: { command: "gh pr comment 164 --body '普通のコメントです'" },
    });
    expect(decision).toBe("deny");
    expect(reason).toContain("引用記法で囲む");
  });

  test("lint-outgoing-body: コマンド置換で渡された本文を拒否する", () => {
    const { decision, reason } = runHook({
      cwd: "/tmp",
      tool_input: {
        command: 'gh pr create --title x --body "$(cat /tmp/x)"',
      },
    });
    expect(decision).toBe("deny");
    expect(reason).toContain("コマンド置換");
  });

  test("pr-delegation-guard: メインの会話からの gh pr create を拒否する", () => {
    const { decision, reason } = runHook({
      cwd: "/tmp",
      tool_input: { command: "gh pr create --draft --title x" },
    });
    expect(decision).toBe("deny");
    expect(reason).toContain("メインの会話から PR 操作");
  });
});

describe("実行順序を維持する", () => {
  test("force-push-guard と pr-delegation-guard の両方に該当する入力は force-push-guard の理由を返す", () => {
    // agent_id なしの git push --force は force-push-guard（2番目）と
    // pr-delegation-guard（6番目）の両方に該当する。先の順序のガードの理由が返るはず。
    const { decision, reason } = runHook({
      cwd: "/tmp",
      tool_input: { command: "git push --force origin feat/x" },
    });
    expect(decision).toBe("deny");
    expect(reason).toContain("force push（");
    expect(reason).not.toContain("メインの会話から PR 操作");
  });
});

describe("該当するガードが無い場合は素通しする", () => {
  test.each([
    ["ls -la", "ls -la"],
    ["bun test", "bun test"],
  ])("%s", (_name, command) => {
    const { decision } = runHook({
      cwd: "/tmp",
      tool_input: { command },
    });
    expect(decision).toBeNull();
  });

  test("空のコマンド", () => {
    const { decision } = runHook({
      cwd: "/tmp",
      tool_input: { command: "" },
    });
    expect(decision).toBeNull();
  });
});
