#!/usr/bin/env bun
// WorktreeCreate / WorktreeRemove hook

import { readInput, run, runSafe } from "./lib.ts";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

interface WorktreeInput {
  hook_event_name?: string;
  cwd?: string;
  name?: string;
}

const input = await readInput<WorktreeInput>();
const logDir = join(homedir(), ".claude", "logs");
await mkdir(logDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[T:.]/g, "_").slice(0, 15);
async function log(message: string): Promise<void> {
  await appendFile(join(logDir, "worktree.log"), `[${timestamp}] ${message}\n`);
}
await log(`Worktree event: ${JSON.stringify(input)}`);

// origin のデフォルトブランチ名を返す。origin/HEAD → remote show の HEAD branch → main の順
async function defaultBranch(repoRoot: string): Promise<string> {
  const head = await runSafe([
    "git",
    "-C",
    repoRoot,
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (head?.startsWith("origin/")) return head.slice("origin/".length);

  const shown = await runSafe(["git", "-C", repoRoot, "remote", "show", "origin"]);
  const match = shown?.match(/^\s*HEAD branch:\s*(\S+)\s*$/m);
  if (match && match[1] !== "(unknown)") return match[1];

  return "main";
}

// git-wt の wt.hook と同じく、新しい worktree を cwd として実行する。
// 失敗しても worktree 作成は成功させ、ログにだけ残す。
async function linkLocalSettings(wtPath: string): Promise<void> {
  const cmd = join(homedir(), ".local", "bin", "wt-link-local-settings");
  try {
    const proc = Bun.spawn([cmd], {
      cwd: wtPath,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
      await log(
        `wt-link-local-settings failed (exit ${exitCode}): ${(stderr || stdout).trim()}`,
      );
    }
  } catch (error) {
    await log(`wt-link-local-settings skipped: ${String(error)}`);
  }
}

const event = input.hook_event_name ?? "";
const cwd = input.cwd ?? ".";
const name = input.name ?? "";

if (event === "WorktreeCreate") {
  if (!name) {
    console.error("Error: name is required");
    process.exit(1);
  }

  const repoRoot = await run(
    ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
  ).catch(() => "");
  if (!repoRoot) {
    console.error("Error: not a git repository");
    process.exit(1);
  }

  const wtPath = join(repoRoot, ".wt", name);

  if (await isDir(wtPath)) {
    console.log(wtPath);
    process.exit(0);
  }

  await run(["git", "-C", repoRoot, "fetch", "origin"]);

  const hasRemoteBranch =
    (await runSafe([
      "git",
      "-C",
      repoRoot,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${name}`,
    ])) !== null;
  const hasLocalBranch =
    (await runSafe([
      "git",
      "-C",
      repoRoot,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${name}`,
    ])) !== null;

  if (hasLocalBranch) {
    await run(["git", "-C", repoRoot, "worktree", "add", wtPath, name]);
  } else if (hasRemoteBranch) {
    await run([
      "git",
      "-C",
      repoRoot,
      "worktree",
      "add",
      "--track",
      "-b",
      name,
      wtPath,
      `origin/${name}`,
    ]);
  } else {
    const base = await defaultBranch(repoRoot);
    await run([
      "git",
      "-C",
      repoRoot,
      "worktree",
      "add",
      wtPath,
      "-b",
      name,
      `origin/${base}`,
    ]);
  }

  await linkLocalSettings(wtPath);
  console.log(wtPath);
} else if (event === "WorktreeRemove") {
  if (!name) {
    console.error("Error: name is required");
    process.exit(1);
  }

  const repoRoot = await run(
    ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
  ).catch(() => "");
  if (!repoRoot) {
    console.error("Error: not a git repository");
    process.exit(1);
  }

  const wtPath = join(repoRoot, ".wt", name);

  if (!(await isDir(wtPath))) {
    console.error(`Worktree not found: ${wtPath}`);
    process.exit(1);
  }

  await run(["git", "-C", repoRoot, "worktree", "remove", wtPath]);
  console.log(`Removed worktree: ${wtPath}`);
}
