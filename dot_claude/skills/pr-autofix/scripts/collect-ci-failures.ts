#!/usr/bin/env bun

import { $ } from "bun";

const repo = process.argv[2];
const prNumber = process.argv[3];

if (!repo || !prNumber) {
  console.error("Usage: bun collect-ci-failures.ts <owner/repo> <prNumber>");
  console.error("Example: bun collect-ci-failures.ts kkhs/platform-domain-app 6186");
  process.exit(1);
}

type Check = {
  name: string;
  state?: string;
  status?: string;
  conclusion?: string;
  bucket?: string;
  workflow?: string;
  link?: string;
  description?: string;
  startedAt?: string;
  completedAt?: string;
};

// `gh pr checks --json` でCIの状況を取得
const checksJson = await $`gh pr checks ${prNumber} --repo ${repo} --json name,state,bucket,workflow,link,description,startedAt,completedAt`.text();
const checks = JSON.parse(checksJson) as Check[];

// 失敗状態の判定: bucketが"fail" / stateが"FAILURE","TIMED_OUT","CANCELLED","ACTION_REQUIRED"
const isFailed = (c: Check) => {
  const state = (c.state ?? "").toUpperCase();
  const bucket = (c.bucket ?? "").toLowerCase();
  return (
    bucket === "fail" ||
    state === "FAILURE" ||
    state === "TIMED_OUT" ||
    state === "CANCELLED" ||
    state === "ACTION_REQUIRED"
  );
};

const failed = checks.filter(isFailed);

type FailedCheck = {
  name: string;
  workflow?: string;
  state?: string;
  bucket?: string;
  description?: string;
  link?: string;
  run_id?: string;
  log_excerpt?: string;
  log_fetch_error?: string;
};

const results: FailedCheck[] = [];

for (const check of failed) {
  // linkからrun_idを抽出: https://github.com/owner/repo/actions/runs/12345/job/67890
  const runIdMatch = check.link?.match(/\/runs\/(\d+)/);
  const runId = runIdMatch?.[1];

  let logExcerpt: string | undefined;
  let logFetchError: string | undefined;

  if (runId) {
    try {
      const logs = await $`gh run view ${runId} --repo ${repo} --log-failed`.text();
      // 末尾を最大8000文字に切り詰める（失敗の本質的なエラーは末尾近くにあることが多い）
      const MAX = 8000;
      logExcerpt = logs.length > MAX ? `...(truncated)...\n${logs.slice(-MAX)}` : logs;
    } catch (e) {
      logFetchError = e instanceof Error ? e.message : String(e);
    }
  }

  results.push({
    name: check.name,
    workflow: check.workflow,
    state: check.state,
    bucket: check.bucket,
    description: check.description,
    link: check.link,
    run_id: runId,
    log_excerpt: logExcerpt,
    log_fetch_error: logFetchError,
  });
}

const output = {
  pr: { repo, number: Number(prNumber) },
  total_checks: checks.length,
  failed_count: failed.length,
  failed_checks: results,
};

console.log(JSON.stringify(output, null, 2));
