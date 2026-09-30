// protected-branch-push-guard の判定ロジックの回帰テスト。
// `bun test` でリポジトリルートから実行する。
//
// 主に固定したいのは次の3点。
//   1. refspec の宛先 / refspec 省略時の現在ブランチ / --delete が保護ブランチなら拒否すること
//   2. feature ブランチ宛の push や push 以外のコマンドは許可すること
//   3. メイン・サブエージェントの区別なく効くこと

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkProtectedBranchPush } from "../dot_claude/hooks/protected-branch-push-guard-lib.ts";

let tempParent: string;
let mainRepo: string;
let featureRepo: string;

function initRepo(path: string, branch: string): void {
  execFileSync("git", ["init", "-b", branch, path], { stdio: "ignore" });
}

beforeAll(() => {
  tempParent = mkdtempSync(join(tmpdir(), "protected-push-guard-"));
  mainRepo = join(tempParent, "on-main");
  featureRepo = join(tempParent, "on-feature");
  initRepo(mainRepo, "main");
  initRepo(featureRepo, "feat/x");
});

afterAll(() => {
  rmSync(tempParent, { recursive: true, force: true });
});

async function decisionOf(
  command: string,
  cwd: string,
  agentId: unknown = undefined,
): Promise<string> {
  const result = await checkProtectedBranchPush({
    command,
    normalizedCommand: command.replace(/\s+/g, " ").trim(),
    cwd,
    agentId,
  });
  return result.action;
}

describe("保護ブランチ宛の push を拒否する", () => {
  test.each([
    ["remote + branch", "git push origin main"],
    ["-u 付き", "git push -u origin main"],
    ["master", "git push origin master"],
    ["develop", "git push origin develop"],
    ["HEAD:main", "git push origin HEAD:main"],
    ["feature:refs/heads/main", "git push origin feature:refs/heads/main"],
    ["refs/heads/main", "git push origin refs/heads/main"],
    ["+ 付き", "git push origin +feat/x:main"],
    ["--delete", "git push origin --delete main"],
    ["-d", "git push -d origin develop"],
    [":main（削除の refspec）", "git push origin :main"],
    ["-C を挟む", "git -C /tmp/wt push origin main"],
    ["cd && push", "cd /tmp/wt && git push origin main"],
    ["複数 refspec の一部", "git push origin feat/x main"],
    ["クォート付き", 'git push origin "main"'],
    ["-o の値を飛ばす", "git push -o ci.skip origin main"],
    ["--all", "git push --all origin"],
    ["--all（feature 上）", "git push origin --all"],
    ["--branches（--all の別名）", "git push --branches origin"],
    ["--mirror", "git push --mirror origin"],
    ["cd && push --all", "cd /tmp/wt && git push --all"],
  ])("%s", async (_name, command) => {
    expect(await decisionOf(command, featureRepo)).toBe("deny");
  });

  test("サブエージェント内でも拒否する", async () => {
    expect(
      await decisionOf("git push origin main", featureRepo, "a109396390d6b0cb2"),
    ).toBe("deny");
  });

  test("拒否理由に保護ブランチ名が含まれる", async () => {
    const result = await checkProtectedBranchPush({
      command: "git push origin HEAD:develop",
      normalizedCommand: "git push origin HEAD:develop",
      cwd: featureRepo,
      agentId: undefined,
    });
    expect(result).toEqual({
      action: "deny",
      reason: expect.stringContaining("保護ブランチ(develop)"),
    });
  });
});

describe("現在のブランチが保護ブランチのとき refspec 省略の push を拒否する", () => {
  test.each([
    ["引数なし", "git push"],
    ["remote のみ", "git push origin"],
    ["-u remote", "git push -u origin"],
    ["HEAD", "git push origin HEAD"],
  ])("%s", async (_name, command) => {
    expect(await decisionOf(command, mainRepo)).toBe("deny");
  });
});

describe("保護ブランチ宛でない push は許可する", () => {
  test.each([
    ["引数なし（feature 上）", "git push", () => featureRepo],
    ["remote のみ（feature 上）", "git push origin", () => featureRepo],
    ["HEAD（feature 上）", "git push origin HEAD", () => featureRepo],
    ["feature ブランチ", "git push -u origin feat/x", () => featureRepo],
    ["HEAD:feature", "git push origin HEAD:feat/y", () => featureRepo],
    ["保護ブランチ上から feature へ", "git push origin HEAD:feat/y", () => mainRepo],
    ["main を含む名前のブランチ", "git push origin main-fix", () => featureRepo],
    ["main/ 配下のブランチ", "git push origin feat/main", () => featureRepo],
    ["feature の削除", "git push origin --delete feat/x", () => featureRepo],
    ["タグのみ", "git push --tags", () => mainRepo],
    ["push 以外", "git status", () => mainRepo],
    ["fetch", "git fetch origin main", () => featureRepo],
    ["別コマンド側の main", "git push origin feat/x && echo main", () => featureRepo],
    ["git repo 外", "git push origin feat/x", () => tmpdir()],
  ])("%s", async (_name, command, cwd) => {
    expect(await decisionOf(command, cwd())).toBe("allow");
  });
});
