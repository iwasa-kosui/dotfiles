// main-branch-guard の判定ロジックの回帰テスト。
// `bun test` でリポジトリルートから実行する。
//
// 主に固定したいのは次の3点。
//   1. `git -C <path>` を挟んでも判定をすり抜けないこと
//   2. merge-base のようなハイフン付きの別コマンドを誤ってブロックしないこと
//   3. cwd を hook の入力から解決すること（フックプロセス自身の cwd で判定しない）

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { BlockedOperation } from "../dot_cursor/hooks/branch-guard-lib.ts";
import { blockedOperations as claudeOperations } from "../dot_claude/hooks/branch-guard-lib.ts";
import {
  blockedOperations as codexOperations,
  checkMainBranchGuard,
} from "../dot_codex/hooks/branch-guard-lib.ts";
import { blockedOperations as cursorOperations } from "../dot_cursor/hooks/branch-guard-lib.ts";
import { resolveShellHookCwd } from "../dot_cursor/hooks/shell-hook-lib.ts";

const repoRoot = join(import.meta.dir, "..");
const hookDirs = ["dot_claude/hooks", "dot_codex/hooks", "dot_cursor/hooks"];

const platforms: Array<[string, BlockedOperation[]]> = [
  ["dot_claude", claudeOperations],
  ["dot_codex", codexOperations],
  ["dot_cursor", cursorOperations],
];

function labelFor(
  operations: BlockedOperation[],
  command: string,
): string | null {
  return operations.find(({ pattern }) => pattern.test(command))?.label ?? null;
}

// [コマンド, 期待するラベル]。null は許可（ブロックしない）
const cases: Array<[string, string | null]> = [
  // 履歴・状態を変更する操作はブロックする
  ["git merge origin/main", "マージ"],
  ["git commit -m x", "コミット"],
  ["git reset --hard", "reset"],
  ["git checkout main", "ブランチ切り替え"],
  ["git switch main", "ブランチ切り替え"],
  ["git rebase origin/main", "リベース"],
  ["git cherry-pick abc1234", "cherry-pick"],
  ["git revert abc1234", "revert"],
  ["git pull", "pull"],
  ["git apply fix.patch", "パッチ適用"],
  ["git am fix.patch", "パッチ適用"],
  ["git mv a.txt b.txt", "git mv"],

  // git -C <path> を挟んでもブロックする
  ["git -C /tmp/x merge origin/main", "マージ"],
  ["git -C /tmp/x commit -m x", "コミット"],
  ["git -C /tmp/x reset --hard", "reset"],
  ["git -C /tmp/x checkout main", "ブランチ切り替え"],
  ["git -C /tmp/x pull", "pull"],
  ['git -C "/tmp/with space" merge origin/main', "マージ"],
  ["git -C '/tmp/quoted' reset --hard", "reset"],

  // ハイフン付きの別コマンドは読み取り専用なので許可する
  ["git merge-base main HEAD", null],
  ["git merge-tree main HEAD", null],
  ["git merge-file a b c", null],
  ["git -C /tmp/x merge-base main HEAD", null],
  ["git commit-tree abc1234", null],
  ["git commit-graph write", null],
  ["git checkout-index -a", null],

  // 中断・dry-run・ファイル復元は許可する
  ["git merge --abort", null],
  ["git rebase --abort", null],
  ["git cherry-pick --abort", null],
  ["git revert --abort", null],
  ["git commit --dry-run", null],
  ["git checkout -- file.txt", null],
  ["git checkout --patch file.txt", null],
  ["git checkout -p", null],

  // 読み取り系は許可する
  ["git status", null],
  ["git diff", null],
  ["git log --oneline -5", null],
  ["git fetch origin main", null],
  ["git branch -r", null],
  ["git worktree add .wt/foo foo", null],

  // 現状の挙動として固定する。保護ブランチ上でのコンフリクト解消はブロックされる
  ["git checkout --theirs file.txt", "ブランチ切り替え"],
];

describe.each(platforms)("blockedOperations (%s)", (_name, operations) => {
  test.each(cases)("%s", (command, expected) => {
    expect(labelFor(operations, command)).toBe(expected);
  });
});

describe("3プラットフォームの共通ライブラリ", () => {
  test.each(["shell-hook-lib.ts", "branch-guard-lib.ts"])(
    "%s の内容が一致する",
    (fileName) => {
      const contents = hookDirs.map((dir) =>
        readFileSync(join(repoRoot, dir, fileName), "utf8"),
      );
      expect(contents[1]).toBe(contents[0]);
      expect(contents[2]).toBe(contents[0]);
    },
  );

  test("判定結果が3プラットフォームで一致する", () => {
    for (const [command] of cases) {
      const labels = platforms.map(([, operations]) =>
        labelFor(operations, command),
      );
      expect(labels[1]).toBe(labels[0]);
      expect(labels[2]).toBe(labels[0]);
    }
  });
});

describe("resolveShellHookCwd", () => {
  test.each([
    [
      "絶対パス",
      "cd /tmp/worktree && git commit -m x",
      "/tmp/main-repo",
      "/tmp/worktree",
    ],
    [
      "ダブルクォート付きパス",
      'cd "/tmp/worktree with space" && git commit -m x',
      "/tmp/main-repo",
      "/tmp/worktree with space",
    ],
    [
      "入力 cwd 基準の相対パス",
      "cd .wt/feature && git commit -m x",
      "/tmp/main-repo",
      "/tmp/main-repo/.wt/feature",
    ],
    [
      "git -C を含むパス",
      "cd /tmp/worktree && git -C /tmp/target commit -m x",
      "/tmp/main-repo",
      "/tmp/target",
    ],
  ])(
    "先頭の cd による %s を実行先 cwd として解決する",
    (_name, command, cwd, expected) => {
      expect(resolveShellHookCwd({ command, cwd })).toBe(expected);
    },
  );

  test("先頭に複数空白がある cd を実行先 cwd として解決する", () => {
    expect(
      resolveShellHookCwd({
        command: "  cd /tmp/worktree && git commit -m x",
        cwd: "/tmp/main-repo",
      }),
    ).toBe("/tmp/worktree");
  });

  test.each([
    [
      "チルダ",
      "cd ~/worktree && git commit -m x",
      join(homedir(), "worktree"),
    ],
    [
      "$HOME",
      "cd $HOME/worktree && git commit -m x",
      join(homedir(), "worktree"),
    ],
    [
      "ダブルクォート付き $HOME",
      'cd "$HOME/worktree with space" && git commit -m x',
      join(homedir(), "worktree with space"),
    ],
    [
      "-- とシングルクォート付きパス",
      "cd -- '/tmp/worktree with space' && git commit -m x",
      "/tmp/worktree with space",
    ],
  ])(
    "先頭の cd による許可済みパス (%s) を解決する",
    (_name, command, expected) => {
      expect(
        resolveShellHookCwd({ command, cwd: "/tmp/main-repo" }),
      ).toBe(expected);
    },
  );

  test.each([
    ["~+", "cd ~+ && git commit -m x", "/tmp/main-repo"],
    ["~-", "cd ~- && git commit -m x", "/tmp/main-repo"],
    ["~user", "cd ~root && git commit -m x", "/tmp/main-repo"],
  ])("未対応チルダ (%s) は採用しない", (_name, command, expected) => {
    expect(
      resolveShellHookCwd({ command, cwd: "/tmp/main-repo" }),
    ).toBe(expected);
  });

  test("引用符内の連続空白を保持する", () => {
    expect(
      resolveShellHookCwd({
        command: 'cd "/tmp/worktree  with-space" && git commit -m x',
        cwd: "/tmp/main-repo",
      }),
    ).toBe("/tmp/worktree  with-space");
  });

  test.each([
    ["環境変数", 'cd "$PWD" && git commit -m x', "/tmp/main-repo"],
    ["コマンド置換", 'cd "$(pwd)" && git commit -m x', "/tmp/main-repo"],
    ["バッククォート", "cd `pwd` && git commit -m x", "/tmp/main-repo"],
    ["glob", "cd * && git commit -m x", "/tmp/main-repo"],
    [
      "single quote 連結",
      "cd /tmp/'main' && git commit -m x",
      "/tmp/main-repo",
    ],
    [
      "double quote 連結",
      'cd /tmp/"main" && git commit -m x',
      "/tmp/main-repo",
    ],
    [
      "バックスラッシュエスケープ",
      "cd /tmp/\\m\\a\\i\\n && git commit -m x",
      "/tmp/main-repo",
    ],
  ])("動的 cwd (%s) は採用しない", (_name, command, expected) => {
    expect(
      resolveShellHookCwd({ command, cwd: "/tmp/main-repo" }),
    ).toBe(expected);
  });

  test("git -C の動的 cwd は採用しない", () => {
    expect(
      resolveShellHookCwd({
        command: 'git -C "$PWD" commit -m x',
        cwd: "/tmp/main-repo",
      }),
    ).toBe("/tmp/main-repo");
  });

  test("git -C のパスを最優先する", () => {
    expect(
      resolveShellHookCwd({ command: "git -C /tmp/target status", cwd: "/tmp/other" }),
    ).toBe("/tmp/target");
  });

  test("git -C のパスの ~ を展開する", () => {
    expect(
      resolveShellHookCwd({ command: "git -C ~/repo status" }),
    ).toBe(join(homedir(), "repo"));
  });

  test("git -C がなければ入力の cwd を使う", () => {
    expect(resolveShellHookCwd({ command: "git status", cwd: "/tmp/other" })).toBe(
      "/tmp/other",
    );
  });

  test("tool_input 側の作業ディレクトリも読む", () => {
    expect(
      resolveShellHookCwd({
        tool_input: { command: "git status", working_directory: "/tmp/from-tool-input" },
      }),
    ).toBe("/tmp/from-tool-input");
  });

  test("どこにも指定がなければプロセスの cwd に落とす", () => {
    expect(resolveShellHookCwd({ command: "git status" })).toBe(process.cwd());
  });
});

describe("checkMainBranchGuard", () => {
  test("main は拒否し、コマンド先頭で移動した linked worktree は許可する", async () => {
    const tempParent = mkdtempSync(join(tmpdir(), "branch-guard-"));
    const mainRepo = join(tempParent, "main-repo");
    const linkedWorktree = join(tempParent, "feature-worktree");

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
          "user.name=Branch Guard Test",
          "-c",
          "user.email=branch-guard@example.invalid",
          "commit",
          "--allow-empty",
          "-m",
          "initial",
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        "git",
        [
          "-C",
          mainRepo,
          "worktree",
          "add",
          "-b",
          "feature",
          linkedWorktree,
        ],
        { stdio: "ignore" },
      );

      const mainResult = await checkMainBranchGuard(
        "git commit -m x",
        mainRepo,
      );
      expect(mainResult.action).toBe("deny");

      const command = `cd "${linkedWorktree}" && git commit -m x`;
      const resolvedCwd = resolveShellHookCwd({ command, cwd: mainRepo });
      expect(resolvedCwd).toBe(linkedWorktree);

      const worktreeResult = await checkMainBranchGuard(command, resolvedCwd);
      expect(worktreeResult.action).toBe("allow");

      const spacedMainCommand = `  cd "${mainRepo}" && git commit -m x`;
      const resolvedMainCwd = resolveShellHookCwd({
        command: spacedMainCommand,
        cwd: tempParent,
      });
      const spacedMainResult = await checkMainBranchGuard(
        spacedMainCommand,
        resolvedMainCwd,
      );
      expect({
        resolvedCwd: resolvedMainCwd,
        action: spacedMainResult.action,
      }).toEqual({ resolvedCwd: mainRepo, action: "deny" });
    } finally {
      rmSync(tempParent, { recursive: true, force: true });
    }
  });
});
