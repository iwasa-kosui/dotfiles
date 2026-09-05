import { mkdirSync, readdirSync } from "node:fs";
import { $ } from "bun";
import { parseArgs as parseOptions } from "node:util";
import { CliError, fail } from "./process.ts";

// ---------------------------------------------------------------------------
// 要約のための純粋関数
// ---------------------------------------------------------------------------

/** ログから機械的に拾えるエラー行のパターン。外れたときは全文をサブエージェントに渡す */
const ERROR_PATTERNS = [
  /##\[error\]/,
  /error TS\d+/,
  /\bError:/,
  /\berror:/,
  /\bFAIL\b/,
  /\bFAILED\b/,
  /^\s*[✕×]/,
  /AssertionError/,
  /Assertion failed/,
  /npm ERR!/,
  /\bpanic:/,
  /Process completed with exit code [1-9]/,
];

const MAX_ERROR_LINES = 12;

export function extractErrorLines(log: string): string[] {
  const lines = new Set<string>();
  for (const raw of log.split("\n")) {
    // gh run view --log-failed は `<job>\t<step>\t<ISO8601> ` を行頭に付ける
    const line = raw
      .replace(/^(?:[^\t]*\t){0,2}\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "")
      .trimEnd();
    const probe = line.trim();
    if (!probe) continue;
    if (!ERROR_PATTERNS.some((pattern) => pattern.test(line))) continue;
    lines.add(truncate(probe, 200));
    if (lines.size >= MAX_ERROR_LINES) break;
  }
  return [...lines];
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 改行を畳んで1行に収める。コメント本文を一覧表示するため */
export function oneLine(body: string, max = 200): string {
  return truncate(body.replace(/\s+/g, " ").trim(), max);
}

const KNOWN_BOTS = [
  "dependabot",
  "renovate",
  "sonarcloud",
  "sonarqubecloud",
  "codecov",
  "coderabbitai",
  "github-actions",
  "claude",
  "codex",
  "copilot",
  "deepsource-io",
];

export function isBot(login: string): boolean {
  return (
    login.endsWith("[bot]") ||
    KNOWN_BOTS.some((bot) => login.toLowerCase().startsWith(bot))
  );
}

const FAILED_STATES = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

export function isFailedCheck(check: {
  state?: string;
  bucket?: string;
}): boolean {
  return (
    (check.bucket ?? "").toLowerCase() === "fail" ||
    FAILED_STATES.has((check.state ?? "").toUpperCase())
  );
}

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

type Args = { ref?: string; repoFlag?: string; out?: string };

type PullRequest = {
  number: number;
  url: string;
  title: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  baseRefName: string;
  headRefName: string;
};

type Check = {
  name: string;
  state?: string;
  bucket?: string;
  workflow?: string;
  link?: string;
  description?: string;
  completedAt?: string;
};

type FailedCheck = {
  name: string;
  workflow?: string;
  state?: string;
  bucket?: string;
  description?: string;
  link?: string;
  run_id?: string;
  error_lines: string[];
  log_excerpt?: string;
  log_fetch_error?: string;
};

type InlineComment = {
  id: number;
  user: { login: string };
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  position: number | null;
  in_reply_to_id?: number;
};

type IssueComment = { id: number; user: { login: string }; body: string };

type Thread = {
  thread_id: number;
  file: string;
  line: number | null;
  resolved: boolean;
  outdated: boolean;
  head_author: string;
  head_is_bot: boolean;
  head_body: string;
  last_author: string;
  reply_count: number;
  comments: { id: number; author: string; is_bot: boolean; body: string }[];
};

type ThreadState = { isResolved: boolean; isOutdated: boolean };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: pr-autofix collect [<pr-number|pr-url>] [--repo <owner/repo>] [--out <directory>]

Collect PR metadata, failing CI checks, review threads and issue comments.
Print a summary; write ci-failures.json and review-comments.json to the output directory.
Default output: /tmp/pr-autofix/<owner>-<repo>-<pr>/iteration-N
Requires gh authentication. This command does not modify the PR or its branch.
Exit codes: 0 collection complete (even when CI fails), 1 collection error, 2 invalid input.
`;

function parseArgs(argv: string[]): Args {
  const { values, positionals } = parseOptions({ args: argv, allowPositionals: true, strict: true,
    options: { repo: { type: "string" }, out: { type: "string" } } });
  if (positionals.length > 1) throw new CliError("Pass at most one PR reference");
  if (positionals[0] && !/^(?:[1-9]\d*|https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/[1-9]\d*)$/.test(positionals[0])) throw new CliError("Expected a PR number or URL");
  if (values.repo && !/^[\w.-]+\/[\w.-]+$/.test(values.repo)) throw new CliError("Expected --repo owner/repo");
  return { ref: positionals[0], repoFlag: values.repo, out: values.out };
}

const PR_FIELDS =
  "number,url,title,state,isDraft,mergeable,mergeStateStatus,baseRefName,headRefName";

async function viewPr(args: Args): Promise<PullRequest> {
  const target = args.ref ? [args.ref] : [];
  const repoOpt = args.repoFlag ? ["--repo", args.repoFlag] : [];
  const json = await $`gh pr view ${target} ${repoOpt} --json ${PR_FIELDS}`.text();
  return JSON.parse(json) as PullRequest;
}

function resolveWorkspace(args: Args, slug: string, prNumber: number): string {
  if (args.out) return args.out;
  const base = `/tmp/pr-autofix/${slug}-${prNumber}`;
  let maxIteration = 0;
  try {
    for (const entry of readdirSync(base)) {
      const n = entry.match(/^iteration-(\d+)$/)?.[1];
      if (n) maxIteration = Math.max(maxIteration, Number(n));
    }
  } catch {
    // base ディレクトリ未作成 = 初回
  }
  return `${base}/iteration-${maxIteration + 1}`;
}

async function ghApi<T>(path: string): Promise<T[]> {
  const out = await $`gh api ${path} --paginate --slurp`.text();
  const parsed = JSON.parse(out) as T[] | T[][];
  return (Array.isArray(parsed) ? parsed.flat() : []) as T[];
}

async function collectCi(repo: string, prNumber: number) {
  const result = await $`gh pr checks ${String(prNumber)} --repo ${repo} --json name,state,bucket,workflow,link,description,completedAt`.quiet().nothrow();
  const checksJson = result.stdout.toString();
  // gh returns 1 for failed checks and 8 for pending checks; both still carry valid JSON.
  if (![0, 1, 8].includes(result.exitCode) || !checksJson.trim()) {
    throw new CliError(result.stderr.toString().trim() || "CI checks could not be collected", 1);
  }
  const checks = JSON.parse(checksJson) as Check[];
  if (!Array.isArray(checks)) throw new CliError("Invalid CI check response", 1);

  const failedChecks = await Promise.all(
    checks.filter(isFailedCheck).map(async (check): Promise<FailedCheck> => {
      const runId = check.link?.match(/\/runs\/(\d+)/)?.[1];
      const base: FailedCheck = {
        name: check.name,
        workflow: check.workflow,
        state: check.state,
        bucket: check.bucket,
        description: check.description,
        link: check.link,
        run_id: runId,
        error_lines: [],
      };
      if (!runId) return base;

      try {
        const log = await $`gh run view ${runId} --repo ${repo} --log-failed`.text();
        const MAX_EXCERPT = 8000;
        return {
          ...base,
          error_lines: extractErrorLines(log),
          log_excerpt:
            log.length > MAX_EXCERPT
              ? `…(truncated)…\n${log.slice(-MAX_EXCERPT)}`
              : log,
        };
      } catch (e) {
        return {
          ...base,
          log_fetch_error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  return { total_checks: checks.length, failed_checks: failedChecks };
}

/** 解決済み判定は REST では取れないので GraphQL の reviewThreads を使う */
async function fetchThreadStates(
  owner: string,
  repoName: string,
  prNumber: number,
): Promise<{ states: Map<number, ThreadState>; truncated: boolean }> {
  const query = `query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100,after:$after){
        pageInfo{hasNextPage endCursor}
        nodes{isResolved isOutdated comments(first:1){nodes{databaseId}}}
      }
    }
  }
}`;

  const states = new Map<number, ThreadState>();
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const afterArg = after ? ["-F", `after=${after}`] : [];
    const out = await $`gh api graphql -f query=${query} -F owner=${owner} -F name=${repoName} -F number=${prNumber} ${afterArg}`
      .nothrow()
      .text();
    const threads = out
      ? JSON.parse(out)?.data?.repository?.pullRequest?.reviewThreads
      : undefined;
    if (!threads) return { states, truncated: true };

    for (const node of threads.nodes ?? []) {
      const databaseId = node?.comments?.nodes?.[0]?.databaseId;
      if (typeof databaseId === "number") {
        states.set(databaseId, {
          isResolved: Boolean(node.isResolved),
          isOutdated: Boolean(node.isOutdated),
        });
      }
    }
    if (!threads.pageInfo?.hasNextPage) return { states, truncated: false };
    after = threads.pageInfo.endCursor;
  }
  return { states, truncated: true };
}

async function collectReview(
  owner: string,
  repoName: string,
  prNumber: number,
) {
  const repo = `${owner}/${repoName}`;
  const [inlineRaw, issueRaw, threadStates] = await Promise.all([
    ghApi<InlineComment>(`repos/${repo}/pulls/${prNumber}/comments`),
    ghApi<IssueComment>(`repos/${repo}/issues/${prNumber}/comments`),
    fetchThreadStates(owner, repoName, prNumber),
  ]);

  const threadMap = new Map<number, InlineComment[]>();
  for (const comment of inlineRaw) {
    const threadId = comment.in_reply_to_id ?? comment.id;
    if (!threadMap.has(threadId)) threadMap.set(threadId, []);
    threadMap.get(threadId)!.push(comment);
  }

  const inlineThreads: Thread[] = [];
  for (const [threadId, comments] of threadMap) {
    comments.sort((a, b) => a.id - b.id);
    const head = comments[0]!;
    const last = comments[comments.length - 1]!;
    const state = threadStates.states.get(head.id);

    inlineThreads.push({
      thread_id: threadId,
      file: head.path,
      line: head.line ?? head.original_line,
      resolved: state?.isResolved ?? false,
      // GraphQL を取り切れなかった場合は position === null を outdated の代用にする
      outdated: state?.isOutdated ?? head.position === null,
      head_author: head.user.login,
      head_is_bot: isBot(head.user.login),
      head_body: head.body,
      last_author: last.user.login,
      reply_count: comments.length - 1,
      comments: comments.map((c) => ({
        id: c.id,
        author: c.user.login,
        is_bot: isBot(c.user.login),
        body: c.body,
      })),
    });
  }

  return {
    inline_threads: inlineThreads,
    issue_comments: issueRaw.map((c) => ({
      id: c.id,
      author: c.user.login,
      is_bot: isBot(c.user.login),
      body: c.body,
    })),
    review_thread_pages_truncated: threadStates.truncated,
  };
}

const LIST_LIMIT = 20;

async function collect(args: Args) {

  let pr = await viewPr(args);
  // mergeable は GitHub 側が非同期に計算する。close 済み・merge 済みでは計算されないので待たない
  for (
    let retry = 0;
    pr.state === "OPEN" && pr.mergeable === "UNKNOWN" && retry < 3;
    retry++
  ) {
    await Bun.sleep(3000);
    pr = await viewPr(args);
  }

  // base リポジトリの owner/repo は URL から取る。head 側を使うと fork PR で誤る
  const urlMatch = pr.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  if (!urlMatch) {
    throw new CliError(`PR の URL から owner/repo を判定できません: ${pr.url}`, 1);
  }
  const owner = urlMatch[1]!;
  const repoName = urlMatch[2]!;
  const repo = `${owner}/${repoName}`;

  const workspace = resolveWorkspace(args, `${owner}-${repoName}`, pr.number);
  mkdirSync(workspace, { recursive: true });

  const [ci, review] = await Promise.all([
    collectCi(repo, pr.number),
    collectReview(owner, repoName, pr.number),
  ]);

  const prMeta = { repo, number: pr.number, url: pr.url };
  await Bun.write(
    `${workspace}/ci-failures.json`,
    JSON.stringify({ pr: prMeta, ...ci }, null, 2),
  );
  await Bun.write(
    `${workspace}/review-comments.json`,
    JSON.stringify({ pr: prMeta, ...review }, null, 2),
  );

  const out: string[] = [
    `workspace: ${workspace}`,
    `pr: ${repo}#${pr.number} "${pr.title}" (${pr.state}, draft: ${pr.isDraft}, base: ${pr.baseRefName}, head: ${pr.headRefName})`,
    `mergeable: ${pr.mergeable} / ${pr.mergeStateStatus}`,
    "",
    `## CI: ${ci.failed_checks.length} failed / ${ci.total_checks} checks`,
  ];

  for (const check of ci.failed_checks) {
    out.push(
      `- ${check.name} [${check.state ?? check.bucket}] run ${check.run_id ?? "unknown"}`,
    );
    if (check.log_fetch_error) {
      out.push(`    ログ取得失敗: ${oneLine(check.log_fetch_error, 120)}`);
    } else if (check.error_lines.length === 0) {
      out.push(
        "    エラー行を抽出できず。ci-failures.json の log_excerpt を参照",
      );
    } else {
      for (const line of check.error_lines) out.push(`    ${line}`);
    }
  }

  const active = review.inline_threads.filter((t) => !t.resolved && !t.outdated);
  const resolvedCount = review.inline_threads.filter((t) => t.resolved).length;
  const outdatedCount = review.inline_threads.filter(
    (t) => !t.resolved && t.outdated,
  ).length;

  out.push(
    "",
    `## Review threads: ${active.length} active / resolved ${resolvedCount} / outdated ${outdatedCount}`,
  );
  if (review.review_thread_pages_truncated) {
    out.push(
      "  注意: GraphQL の reviewThreads を取り切れず、resolved 判定は position ベースの代用値",
    );
  }
  for (const thread of active.slice(0, LIST_LIMIT)) {
    const botMark = thread.head_is_bot ? " [bot]" : "";
    const replies = thread.reply_count > 0 ? ` (+${thread.reply_count} replies)` : "";
    out.push(
      `- [T${thread.thread_id}] ${thread.file}:${thread.line ?? "?"} @${thread.head_author}${botMark}${replies}`,
      `    ${oneLine(thread.head_body)}`,
    );
  }
  if (active.length > LIST_LIMIT) {
    out.push(`- …他 ${active.length - LIST_LIMIT} 件。review-comments.json を参照`);
  }

  out.push("", `## Issue comments: ${review.issue_comments.length}`);
  for (const comment of review.issue_comments.slice(0, LIST_LIMIT)) {
    out.push(
      `- [C${comment.id}] @${comment.author}${comment.is_bot ? " [bot]" : ""}: ${oneLine(comment.body, 160)}`,
    );
  }
  if (review.issue_comments.length > LIST_LIMIT) {
    out.push(
      `- …他 ${review.issue_comments.length - LIST_LIMIT} 件。review-comments.json を参照`,
    );
  }

  console.log(out.join("\n"));
}

export async function runCli(argv: string[]): Promise<number> {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); return 0; }
  try {
    if (argv[0] !== "collect") throw new CliError(`Unknown command: ${argv[0]}`);
    await collect(parseArgs(argv.slice(1)));
    return 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS")) return fail(new CliError(String(error)));
    return fail(error);
  }
}

