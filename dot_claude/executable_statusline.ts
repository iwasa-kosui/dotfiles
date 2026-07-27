#!/usr/bin/env bun
// Claude Code statusline
// claude-powerline に描画を任せ、worktree名だけ capsule として追記する。
// claude-powerline には worktree名を表示する segment がないため。

import { getWorktreeName } from "./hooks/lib.ts";

interface StdinInput {
  cwd?: string;
  workspace?: { current_dir?: string };
}

// Tokyo Night: claude-powerline の tokyo-night テーマに合わせた控えめな配色
const BG = [36, 40, 59] as const;
const FG = [86, 95, 137] as const;

const fgC = (c: readonly number[]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bgC = (c: readonly number[]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CAP_LEFT = "";
const CAP_RIGHT = "";
const WORKTREE_ICON = "";

const raw = await Bun.stdin.text();

const proc = Bun.spawn(["claude-powerline"], {
  stdin: new Response(raw),
  stdout: "pipe",
  stderr: "inherit",
});
const out = await new Response(proc.stdout).text();
await proc.exited;

process.stdout.write(out);

let input: StdinInput = {};
try {
  input = JSON.parse(raw) as StdinInput;
} catch {
  process.exit(0);
}

const cwd = input.workspace?.current_dir ?? input.cwd ?? "";
const worktreeName = cwd ? await getWorktreeName(cwd) : null;

if (worktreeName) {
  if (!out.endsWith("\n")) process.stdout.write("\n");
  process.stdout.write(
    `${fgC(BG)}${CAP_LEFT}${RESET}` +
      `${bgC(BG)}${fgC(FG)}${DIM} ${WORKTREE_ICON} ${worktreeName} ${RESET}` +
      `${fgC(BG)}${CAP_RIGHT}${RESET}`,
  );
}
