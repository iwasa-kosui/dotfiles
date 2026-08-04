#!/usr/bin/env bun
// Claude Code statusline
// claude-powerline に描画を任せ、worktree名とコンテキスト超過警告を capsule として追記する。
// claude-powerline には worktree名の segment がなく、context segment の色は
// コンテキストウィンドウに対する残り割合の固定閾値でしか変わらないため、
// 1Mコンテキストで0.2Mを超えたことを絶対トークン数で警告できない。

import { getWorktreeName } from "./hooks/lib.ts";

// 1Mコンテキストのセッションでも0.2Mを超えたら警告する。
// 割合ではなく絶対トークン数で判定するのは、1Mでは0.2Mが20%にすぎず
// claude-powerline の閾値（残り40%以下で警告）に到達しないため。
const CONTEXT_WARN_TOKENS = 200_000;

interface StdinInput {
  cwd?: string;
  workspace?: { current_dir?: string };
  context_window?: {
    current_usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

// Tokyo Night: claude-powerline の tokyo-night テーマに合わせた配色
const BG = [36, 40, 59] as const;
const FG = [86, 95, 137] as const;
// tokyo-night テーマの contextCritical と同色
const WARN_BG = [247, 118, 142] as const;
const WARN_FG = [26, 27, 38] as const;

const fgC = (c: readonly number[]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bgC = (c: readonly number[]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
// Nerd Font の Private Use Area はエディタやツールを通すと欠落しやすいためエスケープで書く
const CAP_LEFT = "\ue0b6"; // nf-pl-left_half_circle_thick
const CAP_RIGHT = "\ue0b4"; // nf-pl-right_half_circle_thick
const WORKTREE_ICON = "\uf1bb"; // nf-fa-tree
const WARN_ICON = "\uf071"; // nf-fa-warning

const capsule = (
  bg: readonly number[],
  fg: readonly number[],
  text: string,
  attr: string,
) =>
  `${fgC(bg)}${CAP_LEFT}${RESET}` +
  `${bgC(bg)}${fgC(fg)}${attr} ${text} ${RESET}` +
  `${fgC(bg)}${CAP_RIGHT}${RESET}`;

const formatTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : `${(n / 1_000).toFixed(1)}k`;

const raw = await Bun.stdin.text();

let input: StdinInput = {};
try {
  input = JSON.parse(raw) as StdinInput;
} catch {
  // 追記分を諦めて claude-powerline の出力だけ返す
}

const proc = Bun.spawn(["claude-powerline"], {
  stdin: new Response(raw),
  stdout: "pipe",
  stderr: "inherit",
});
const out = await new Response(proc.stdout).text();
await proc.exited;

process.stdout.write(out);

const cwd = input.workspace?.current_dir ?? input.cwd ?? "";
const worktreeName = cwd ? await getWorktreeName(cwd) : null;

// current_usage は Claude Code 2.0.70+ でのみ渡ってくる。無い場合は警告を出さない。
const usage = input.context_window?.current_usage;
const contextTokens = usage
  ? (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  : null;

const extras: string[] = [];

if (worktreeName) {
  extras.push(capsule(BG, FG, `${WORKTREE_ICON} ${worktreeName}`, DIM));
}

if (contextTokens !== null && contextTokens > CONTEXT_WARN_TOKENS) {
  extras.push(
    capsule(
      WARN_BG,
      WARN_FG,
      `${WARN_ICON} CONTEXT ${formatTokens(contextTokens)}`,
      BOLD,
    ),
  );
}

if (extras.length > 0) {
  if (!out.endsWith("\n")) process.stdout.write("\n");
  process.stdout.write(extras.join(" "));
}
