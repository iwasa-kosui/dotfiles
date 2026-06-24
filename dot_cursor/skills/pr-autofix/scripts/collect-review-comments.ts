#!/usr/bin/env bun

import { $ } from "bun";

const repo = process.argv[2];
const prNumber = process.argv[3];

if (!repo || !prNumber) {
  console.error("Usage: bun collect-review-comments.ts <owner/repo> <prNumber>");
  console.error("Example: bun collect-review-comments.ts kkhs/platform-domain-app 6186");
  process.exit(1);
}

const [owner, repoName] = repo.split("/");
if (!owner || !repoName) {
  console.error("Invalid <owner/repo> format");
  process.exit(1);
}

// 共通ヘルパ: GitHub API JSON取得
async function ghApi<T>(path: string): Promise<T> {
  const out = await $`gh api ${path} --paginate`.text();
  return JSON.parse(out) as T;
}

// bot判定: login末尾の[bot]、または既知のbot名（kkhs社内ボット含む）
const KNOWN_BOTS = [
  "dependabot",
  "renovate",
  "sonarcloud",
  "sonarqubecloud",
  "codecov",
  "coderabbitai",
  "github-actions",
  "claude",
  "copilot",
  "deepsource-io",
];
const isBot = (login: string) => {
  if (login.endsWith("[bot]")) return true;
  return KNOWN_BOTS.some((b) => login.toLowerCase().startsWith(b));
};

// PRファイル一覧（行存在判定の補助）
type InlineComment = {
  id: number;
  user: { login: string };
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  position: number | null;
  original_position: number | null;
  in_reply_to_id?: number;
  created_at: string;
  updated_at: string;
  pull_request_review_id?: number;
};

type IssueComment = {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
  updated_at: string;
};

const inlineRaw = await ghApi<InlineComment[]>(
  `repos/${owner}/${repoName}/pulls/${prNumber}/comments`,
);
const issueRaw = await ghApi<IssueComment[]>(
  `repos/${owner}/${repoName}/issues/${prNumber}/comments`,
);

// スレッドごとにまとめる: in_reply_to_id があるものは親に紐付ける
type Thread = {
  thread_id: number;
  file: string;
  line: number | null;
  outdated: boolean;
  head_author: string;
  head_is_bot: boolean;
  head_body: string;
  head_id: number;
  last_author: string;
  last_is_bot: boolean;
  reply_count: number;
  comments: { id: number; author: string; is_bot: boolean; body: string }[];
};

const threadMap = new Map<number, InlineComment[]>();
for (const c of inlineRaw) {
  const threadId = c.in_reply_to_id ?? c.id;
  if (!threadMap.has(threadId)) threadMap.set(threadId, []);
  threadMap.get(threadId)!.push(c);
}

const threads: Thread[] = [];
for (const [threadId, comments] of threadMap) {
  comments.sort((a, b) => a.id - b.id);
  const head = comments[0];
  const last = comments[comments.length - 1];
  // outdated判定: positionがnull = 該当行がdiff上に存在しない（変更済み or その後の編集で消えた）
  const outdated = head.position === null;

  threads.push({
    thread_id: threadId,
    file: head.path,
    line: head.line ?? head.original_line,
    outdated,
    head_author: head.user.login,
    head_is_bot: isBot(head.user.login),
    head_body: head.body,
    head_id: head.id,
    last_author: last.user.login,
    last_is_bot: isBot(last.user.login),
    reply_count: comments.length - 1,
    comments: comments.map((c) => ({
      id: c.id,
      author: c.user.login,
      is_bot: isBot(c.user.login),
      body: c.body,
    })),
  });
}

// general PR commentsもbot/人間で分類
const issueComments = issueRaw.map((c) => ({
  id: c.id,
  author: c.user.login,
  is_bot: isBot(c.user.login),
  body: c.body,
}));

const output = {
  pr: { repo, number: Number(prNumber) },
  inline_threads: threads,
  issue_comments: issueComments,
  stats: {
    inline_thread_count: threads.length,
    inline_active_count: threads.filter((t) => !t.outdated).length,
    inline_outdated_count: threads.filter((t) => t.outdated).length,
    inline_bot_count: threads.filter((t) => t.head_is_bot).length,
    issue_comment_count: issueComments.length,
    issue_bot_count: issueComments.filter((c) => c.is_bot).length,
  },
};

console.log(JSON.stringify(output, null, 2));
