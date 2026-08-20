// commit-message-guard の判定ロジックの回帰テスト。
// `bun test` でリポジトリルートから実行する。
//
// 主に固定したいのは次の3点。
//   1. PowerShell の here-string `@'...'@` を zsh に渡した形をブロックすること
//   2. 通常のコミットメッセージを誤ってブロックしないこと
//   3. -F で渡したメッセージファイルの先頭の `@` も検出すること

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractCommitMessageSources,
  startsWithAtSign,
} from "../dot_claude/hooks/commit-message-guard-lib.ts";
import { normalizeShellCommand } from "../dot_claude/hooks/shell-hook-lib.ts";

const hookPath = join(
  import.meta.dir,
  "..",
  "dot_claude/hooks/executable_commit-message-guard.ts",
);

function sources(command: string) {
  return extractCommitMessageSources(normalizeShellCommand({ command }));
}

function inlineBlocked(command: string): boolean {
  return sources(command)
    .filter((source) => source.kind === "inline")
    .some((source) => startsWithAtSign(source.value));
}

function filePaths(command: string): string[] {
  return sources(command)
    .filter((source) => source.kind === "file")
    .map((source) => source.path);
}

// hook 本体を実行して decision を取り出す
function runHook(command: string, cwd: string): string | null {
  const stdout = execFileSync("bun", [hookPath], {
    input: JSON.stringify({ cwd, tool_input: { command } }),
    encoding: "utf8",
  });
  if (stdout.trim() === "") return null;
  return (JSON.parse(stdout) as { decision?: string }).decision ?? null;
}

describe("here-string の混入をブロックする", () => {
  test.each([
    ["-m の直後に @'", "git commit -m @'\nfeat: 要約\n\n本文\n'@"],
    ["--message= の直後に @'", "git commit --message=@'\nfeat: 要約\n'@"],
    ['-m の直後に @"', 'git commit -m @"\nfeat: 要約\n"@'],
    ["-am の直後に @'", "git commit -am @'\nfeat: 要約\n'@"],
    ["値が -m に直結", "git commit -m@'\nfeat: 要約\n'@"],
    ["git -C を挟む", "git -C /tmp/x commit -m @'\nfeat: 要約\n'@"],
    ["クォート内の先頭が @", "git commit -m '@\nfeat: 要約\n@'"],
    ["ダブルクォート内の先頭が @", 'git commit -m "@ feat: 要約"'],
  ])("%s", (_name, command) => {
    expect(inlineBlocked(command)).toBe(true);
  });
});

describe("通常のコミットは許可する", () => {
  test.each([
    ["1行メッセージ", "git commit -m 'feat(scope): 要約'"],
    ["本文に @ を含む", 'git commit -m "fix(hooks): @ で始まる本文を弾く"'],
    ["-am", "git commit -am 'chore: 更新'"],
    ["メールアドレスを含む", "git commit -m 'chore: ko@example.com を追記'"],
    ["変数展開", 'git commit -m "$msg"'],
    ["コマンド置換", 'git commit -m "$(cat /tmp/msg.txt)"'],
    ["-F でファイル指定", "git commit -F /tmp/commit-msg.txt"],
    ["--amend", "git commit --amend --no-edit"],
    ["commit 以外のサブコマンド", "git commit-tree abc1234"],
    ["git commit を含まない", "echo -m @'x'@"],
  ])("%s", (_name, command) => {
    expect(inlineBlocked(command)).toBe(false);
  });
});

describe("メッセージファイルの抽出", () => {
  test.each([
    ["-F", "git commit -F /tmp/commit-msg.txt", ["/tmp/commit-msg.txt"]],
    [
      "--file=",
      "git commit --file=/tmp/commit-msg.txt",
      ["/tmp/commit-msg.txt"],
    ],
    ["標準入力は対象外", "git commit -F -", []],
    ["-m だけならファイルなし", "git commit -m 'chore: 更新'", []],
  ])("%s", (_name, command, expected) => {
    expect(filePaths(command)).toEqual(expected);
  });
});

describe("hook 本体", () => {
  test("here-string を渡したコミットをブロックする", () => {
    expect(runHook("git commit -m @'\nfeat: 要約\n'@", tmpdir())).toBe("block");
  });

  test("通常のコミットは許可する", () => {
    expect(runHook("git commit -m 'feat(scope): 要約'", tmpdir())).toBeNull();
  });

  test("先頭が @ のメッセージファイルをブロックする", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-message-guard-"));
    try {
      writeFileSync(join(dir, "msg.txt"), "@\nfeat: 要約\n@\n");
      expect(runHook("git commit -F msg.txt", dir)).toBe("block");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("正常なメッセージファイルは許可する", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-message-guard-"));
    try {
      writeFileSync(join(dir, "msg.txt"), "feat: 要約\n\n本文\n");
      expect(runHook("git commit -F msg.txt", dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("存在しないメッセージファイルは許可する", () => {
    expect(
      runHook("git commit -F /tmp/does-not-exist-msg.txt", tmpdir()),
    ).toBeNull();
  });
});
