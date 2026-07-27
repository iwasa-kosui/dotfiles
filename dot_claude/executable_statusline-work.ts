#!/usr/bin/env bun
// Claude Code statusline for work profile
// Delegates to `ccusage statusline` and appends a worktree segment on a new line.

import { getWorktreeName } from "./hooks/lib.ts";

interface StdinInput {
  cwd?: string;
  workspace?: { current_dir?: string };
}

const TN = {
  bgSurface: [36, 40, 59],
  comment: [86, 95, 137],
} as const;

const fgC = (c: readonly number[]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bgC = (c: readonly number[]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const SEP = "";
const WORKTREE_ICON = "";

const raw = await Bun.stdin.text();

const proc = Bun.spawn(["ccusage", "statusline"], {
  stdin: new Response(raw),
  stdout: "pipe",
  stderr: "inherit",
});
const ccusageOut = await new Response(proc.stdout).text();
await proc.exited;

process.stdout.write(ccusageOut);

let input: StdinInput = {};
try {
  input = JSON.parse(raw) as StdinInput;
} catch {
  process.exit(0);
}

const cwd = input.workspace?.current_dir ?? input.cwd ?? "";
const worktreeName = cwd ? await getWorktreeName(cwd) : null;

if (worktreeName) {
  if (!ccusageOut.endsWith("\n")) process.stdout.write("\n");
  const bg = TN.bgSurface;
  const fg = TN.comment;
  process.stdout.write(
    `${bgC(bg)}${fgC(fg)}${DIM} ${WORKTREE_ICON} ${worktreeName} ${RESET}${fgC(bg)}${SEP}${RESET}`,
  );
}
