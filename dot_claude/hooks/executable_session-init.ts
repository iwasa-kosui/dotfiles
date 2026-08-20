#!/usr/bin/env bun
// SessionStart hook: Worktree情報・Jira課題・GitHub PR情報・引き継ぎドキュメントを取得

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readInput, run, runSafe } from "./lib.ts";

const input = await readInput<{ cwd?: string }>();
const cwd = input.cwd ?? ".";

// handoff スキルが書き出したドキュメントのうち、同じリポジトリ・ブランチの最新1件を探す。
// 本文は読み込まない。自動圧縮を切って handoff で区切る運用だと件数が増えるため、
// 全文を毎回 SessionStart に載せるとコンテキストを節約する目的と矛盾する。
async function latestHandoff(
  commonDir: string,
  branch: string,
): Promise<{ path: string; mtime: Date } | null> {
  // commonDir は worktree でもメインリポジトリの .git を指すため、worktree 内から
  // 起動しても引き継ぎ先はメインリポジトリ名で揃う
  const repo = basename(dirname(commonDir));
  const dir = join(
    homedir(),
    ".claude",
    "handoffs",
    repo,
    branch.replaceAll("/", "-"),
  );
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const latest = entries
    .filter((e) => e.endsWith(".md"))
    .sort()
    .pop();
  if (!latest) return null;
  const path = join(dir, latest);
  return { path, mtime: (await stat(path)).mtime };
}

let output = "";

// --- Worktree情報 ---
const isGitRepo =
  (await runSafe(["git", "-C", cwd, "rev-parse", "--is-inside-work-tree"])) ===
  "true";

if (isGitRepo) {
  await runSafe([
    join(homedir(), ".local", "bin", "worktree-activity"),
    "record",
    "claude",
    cwd,
  ]);
  const gitDir = await runSafe(["git", "-C", cwd, "rev-parse", "--git-dir"]);
  const branch =
    (await runSafe([
      "git",
      "-C",
      cwd,
      "symbolic-ref",
      "--short",
      "HEAD",
    ])) ??
    (await runSafe(["git", "-C", cwd, "rev-parse", "--short", "HEAD"]));

  if (gitDir?.includes("/worktrees/")) {
    const wtPath = await run(["pwd"], { cwd });
    output += `## Worktree (既存)
- パス: ${wtPath}
- ブランチ: ${branch}
- **重要**: 既にworktree内で作業中です。このまま \`${wtPath}\` 内で作業を続行してください。
`;
  } else {
    output += `## Worktree
- **未作成**: プロンプト内容に基づいてworktreeを作成してください（CLAUDE.mdのWorktree Workflowを参照）
`;
  }

  // --- Git worktree一覧 ---
  const worktrees = await runSafe([
    "git",
    "-C",
    cwd,
    "worktree",
    "list",
  ]);
  output += `## Git情報
- ブランチ: ${branch}
`;
  if (worktrees) {
    output += `- ワークツリー:\n${worktrees
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")}\n`;
  }

  // --- 引き継ぎドキュメント ---
  const commonDir = await runSafe([
    "git",
    "-C",
    cwd,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (commonDir && branch) {
    const handoff = await latestHandoff(commonDir, branch);
    if (handoff) {
      output += `\n## 引き継ぎドキュメント
- パス: ${handoff.path}
- 更新: ${handoff.mtime.toISOString()}
- 前回のセッションが handoff を残しています。作業を再開する場合は Read で読んでください（本文は自動では読み込まれません）
`;
    }
  }

  // --- GitHub PR情報 ---
  const prJson = await runSafe([
    "gh",
    "pr",
    "view",
    "--json",
    "number,title,state,url",
  ]);
  if (prJson) {
    try {
      const pr = JSON.parse(prJson) as {
        number: number;
        title: string;
        state: string;
        url: string;
      };
      if (pr.number) {
        output += `\n## GitHub PR
- #${pr.number}: ${pr.title} (${pr.state})
- URL: ${pr.url}
`;
      }
    } catch {
      // invalid JSON, skip
    }
  }

  // --- Jira課題情報 ---
  const hasJira = await runSafe(["which", "jira"]);
  if (hasJira && branch) {
    const match = branch.match(/[A-Z]+-\d+/);
    if (match) {
      const ticketId = match[0];
      const jiraInfo = await runSafe(["jira", "get", ticketId]);
      if (jiraInfo) {
        output += `\n## Jira課題\n${jiraInfo}\n`;
      }
    }
  }
}

if (output) {
  process.stdout.write(output);
}
