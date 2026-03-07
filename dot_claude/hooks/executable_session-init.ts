#!/usr/bin/env bun
// SessionStart hook: Worktree情報・Jira課題・GitHub PR情報を取得

import { readInput, run, runSafe } from "./lib.ts";

const input = await readInput<{ cwd?: string }>();
const cwd = input.cwd ?? ".";

let output = "";

// --- Worktree情報 ---
const isGitRepo =
  (await runSafe(["git", "-C", cwd, "rev-parse", "--is-inside-work-tree"])) ===
  "true";

if (isGitRepo) {
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
