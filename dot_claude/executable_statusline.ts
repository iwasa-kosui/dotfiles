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
  effort?: { level?: string };
  pr?: { number?: number; url?: string };
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
const EFFORT_ICON = "\uf0e4"; // nf-fa-dashboard
const PR_ICON = "\uf407"; // nf-oct-git_pull_request

const capsule = (
  bg: readonly number[],
  fg: readonly number[],
  text: string,
  attr: string,
) =>
  `${fgC(bg)}${CAP_LEFT}${RESET}` +
  `${bgC(bg)}${fgC(fg)}${attr} ${text} ${RESET}` +
  `${fgC(bg)}${CAP_RIGHT}${RESET}`;

// 3桁区切りの K / M は4桁区切りの日本語だと量が掴みにくいので、万・億に置き換える
const jaCount = (n: number) => {
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (n >= 100_000_000) return `${trim((n / 100_000_000).toFixed(1))}億`;
  if (n >= 10_000) {
    const man = n / 10_000;
    return man >= 100 ? `${Math.round(man)}万` : `${trim(man.toFixed(1))}万`;
  }
  return `${Math.round(n)}`;
};

const jaTokens = (n: number) => `${jaCount(n)}トークン`;

// OSC 8。対応端末では text がクリック可能になる
const link = (url: string, text: string) =>
  `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;

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

// claude-powerline の session セグメント（`§ 3.4M tokens`）だけを日本語表記にする。
// `§ ` を含めてマッチさせることで today など他セグメントの tokens 表記には触らない
const localizeSessionTokens = (s: string) =>
  s.replace(
    /§ (\d+(?:\.\d+)?)([KM])? tokens/,
    (_, num: string, unit?: string) => {
      const scale = unit === "M" ? 1_000_000 : unit === "K" ? 1_000 : 1;
      return `§ ${jaTokens(Number(num) * scale)}`;
    },
  );

process.stdout.write(localizeSessionTokens(out));

const cwd = input.workspace?.current_dir ?? input.cwd ?? "";
const worktreeName = cwd ? await getWorktreeName(cwd) : null;

// current_usage は Claude Code 2.0.70+ でのみ渡ってくる。無い場合は警告を出さない。
const usage = input.context_window?.current_usage;
const contextTokens = usage
  ? (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  : null;

const effortLevel = input.effort?.level ?? null;
const prNumber = input.pr?.number ?? null;
const prUrl = input.pr?.url ?? null;

const extras: string[] = [];

if (worktreeName) {
  extras.push(capsule(BG, FG, `${WORKTREE_ICON} ${worktreeName}`, DIM));
}

if (prNumber !== null && prUrl) {
  extras.push(link(prUrl, capsule(BG, FG, `${PR_ICON} #${prNumber}`, DIM)));
}

if (effortLevel) {
  extras.push(capsule(BG, FG, `${EFFORT_ICON} ${effortLevel}`, DIM));
}

if (contextTokens !== null && contextTokens > CONTEXT_WARN_TOKENS) {
  extras.push(
    capsule(
      WARN_BG,
      WARN_FG,
      `${WARN_ICON} CONTEXT ${jaCount(contextTokens)}`,
      BOLD,
    ),
  );
}

if (extras.length > 0) {
  if (!out.endsWith("\n")) process.stdout.write("\n");
  process.stdout.write(extras.join(" "));
}
