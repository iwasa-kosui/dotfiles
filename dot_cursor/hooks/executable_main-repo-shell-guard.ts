#!/usr/bin/env bun
// beforeShellExecution / preToolUse(Shell) hook:
// メインリポジトリの保護ブランチでシェル経由のファイル変更をブロック

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { readInput, runSafe } from "./lib.ts";
import {
  allowResponse,
  checkProtectedMainRepo,
  checkProtectedMainRepoCwd,
  denyResponse,
  expandHome,
} from "./repo-guard-lib.ts";

type ShellHookInput = {
  command?: string;
  cwd?: string;
  tool_input?: { command?: string; working_directory?: string };
};

const input = await readInput<ShellHookInput>();
const command = (input.command ?? input.tool_input?.command ?? "").replace(
  /\s+/g,
  " ",
).trim();
const cwd = expandHome(
  input.cwd ?? input.tool_input?.working_directory ?? process.cwd(),
);

if (!command) {
  allowResponse();
  process.exit(0);
}

// worktree 作成は許可
if (/\b(git\s+worktree\s+add|git-wt)\b/.test(command)) {
  allowResponse();
  process.exit(0);
}

// 明らかな読み取り専用コマンドは許可（リダイレクト付き echo/printf は除外）
const hasRedirect = /(?:^|[;&|]\s*|\s)(?:\d?>>?)\s*\S/.test(command);
const readOnlyPatterns = [
  /^\s*git\s+(status|diff|log|show|branch|fetch|remote|rev-parse|ls-files|blame|grep|stash\s+list|worktree\s+list|config\s+--get)\b/,
  /^\s*gh\s+(pr\s+(view|list|checks|diff|status)|api\s+.*\bGET\b)\b/,
  /^\s*chezmoi\s+(diff|status|managed|source-path|target-path)\b/,
  /^\s*(ls|pwd|which|command|type|env|printenv|date|whoami|uname)\b/,
  /^\s*(npm|pnpm|yarn|bun)\s+(test|run\s+test|run\s+lint|run\s+check|run\s+typecheck)\b/,
  /^\s*(cargo|go)\s+(test|check|build)\b/,
  /^\s*rg\b/,
  /^\s*grep\b/,
];

if (
  !hasRedirect &&
  readOnlyPatterns.some((pattern) => pattern.test(command))
) {
  allowResponse();
  process.exit(0);
}

if (!hasRedirect && /^\s*(echo|printf)\b/.test(command)) {
  allowResponse();
  process.exit(0);
}

// ファイル変更を伴う可能性がある操作
const writePatterns = [
  />\s*[^\s&|;]+/,
  />>\s*[^\s&|;]+/,
  /\btee\b/,
  /\btouch\b/,
  /\bmkdir\b/,
  /\bcp\b/,
  /\bmv\b/,
  /\brm\b/,
  /\btruncate\b/,
  /\binstall\b/,
  /\bsed\s+-i/,
  /\bperl\s+-pi/,
  /\bsponge\b/,
  /\bcat\s+<<[^>]*>\s*/,
  /\bchezmoi\s+apply\b/,
  /\bgit\s+(add|restore|checkout\s+--|stash\s+(pop|apply)|clean)\b/,
  /\bpatch\s+-p/,
  /\bprintf\s+[^;|&]*>/,
  /\becho\s+[^;|&]*>/,
  /\bbun\s+-e\b/,
  /\bnode\s+-e\b/,
  /\bpython3?\s+-c\b/,
];

if (!writePatterns.some((pattern) => pattern.test(command))) {
  allowResponse();
  process.exit(0);
}

// リダイレクト先がリポジトリ外なら許可
const redirectTargets = extractRedirectTargets(command);
if (
  redirectTargets.length > 0 &&
  (await allTargetsOutsideRepo(redirectTargets, cwd))
) {
  allowResponse();
  process.exit(0);
}

const cwdResult = await checkProtectedMainRepoCwd(cwd);
if (cwdResult.action === "deny") {
  denyResponse(
    `${cwdResult.reason}（シェルコマンド: ${truncateCommand(command)}）`,
  );
  process.exit(0);
}

for (const targetPath of extractExplicitPaths(command, cwd)) {
  const result = await checkProtectedMainRepo(targetPath, cwd);
  if (result.action === "deny") {
    denyResponse(
      `${result.reason}（シェルコマンド: ${truncateCommand(command)}）`,
    );
    process.exit(0);
  }
}

allowResponse();

function truncateCommand(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function extractRedirectTargets(cmd: string): string[] {
  const targets: string[] = [];
  const re = /(?:^|[;&|]\s*|\s)(?:\d?>>?)\s*([^\s;&|]+)/g;
  for (const match of cmd.matchAll(re)) {
    const target = match[1];
    if (target) targets.push(target);
  }
  return targets;
}

function extractExplicitPaths(cmd: string, baseCwd: string): string[] {
  const paths: string[] = [];

  const gitCwdMatch = cmd.match(
    /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/,
  );
  const gitCwd =
    gitCwdMatch?.[1] ?? gitCwdMatch?.[2] ?? gitCwdMatch?.[3];
  if (gitCwd) {
    paths.push(expandHome(gitCwd));
  }

  const fileArgPatterns = [
    /\btouch\s+((?:"[^"]+"|'[^']+'|\S+)(?:\s+(?:"[^"]+"|'[^']+'|\S+))*)/,
    /\bmkdir\s+(?:-p\s+)?((?:"[^"]+"|'[^']+'|\S+)(?:\s+(?:"[^"]+"|'[^']+'|\S+))*)/,
    /\bcp\s+((?:"[^"]+"|'[^']+'|\S+)\s+(?:"[^"]+"|'[^']+'|\S+))/,
    /\bmv\s+((?:"[^"]+"|'[^']+'|\S+)\s+(?:"[^"]+"|'[^']+'|\S+))/,
  ];

  for (const pattern of fileArgPatterns) {
    const match = cmd.match(pattern);
    if (!match?.[1]) continue;
    for (const token of tokenizeArgs(match[1])) {
      paths.push(resolvePath(token, baseCwd));
    }
  }

  return [...new Set(paths)];
}

function tokenizeArgs(args: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of args.matchAll(re)) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token) tokens.push(token);
  }
  return tokens;
}

function resolvePath(token: string, baseCwd: string): string {
  const expanded = expandHome(token);
  return isAbsolute(expanded) ? expanded : resolve(baseCwd, expanded);
}

async function allTargetsOutsideRepo(
  targets: string[],
  baseCwd: string,
): Promise<boolean> {
  for (const target of targets) {
    if (target === "/dev/null") continue;

    const absolute = resolvePath(target, baseCwd);
    if (absolute.startsWith("/tmp/") || absolute.startsWith("/var/folders/")) {
      continue;
    }

    const repoRoot = await runSafe([
      "git",
      "-C",
      baseCwd,
      "rev-parse",
      "--show-toplevel",
    ]);
    if (!repoRoot) continue;
    if (
      absolute.startsWith(repoRoot + "/") ||
      absolute === repoRoot ||
      absolute.startsWith(homedir() + "/.cursor/projects/")
    ) {
      return false;
    }
  }
  return true;
}
