#!/usr/bin/env bun
// WorktreeCreate / WorktreeRemove hook

import { readInput, run } from "./lib.ts";
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
await appendFile(
  join(logDir, "worktree.log"),
  `[${timestamp}] Worktree event: ${JSON.stringify(input)}\n`,
);

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

  await run(["git", "-C", repoRoot, "worktree", "add", wtPath, "-b", name]);
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
