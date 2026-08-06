// シェル系 hook の共通ユーティリティ。
// dot_claude/hooks/ dot_codex/hooks/ dot_cursor/hooks/ の3箇所で同一内容を保つこと。
// 内容がずれると保護の抜け穴になるため tests/branch-guard-lib.test.ts が一致を検証する。

import { homedir } from "node:os";

export const PROTECTED_BRANCHES = ["main", "master", "develop"] as const;

export type ProtectedBranch = (typeof PROTECTED_BRANCHES)[number];

export function isProtectedBranch(branch: string): branch is ProtectedBranch {
  return (PROTECTED_BRANCHES as readonly string[]).includes(branch);
}

export type ShellHookInput = {
  command?: string;
  cwd?: string;
  tool_input?: {
    command?: string;
    working_directory?: string;
    cwd?: string;
    workdir?: string;
  };
};

// git の直後に -C <path> が挟まってもマッチする接頭辞。
// /\bgit\s+merge\b/ のように git の直後に空白しか許さないパターンを書くと
// `git -C <path> merge` が判定をすり抜ける。
export const GIT_PREFIX = /\bgit(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+/;

export function normalizeShellCommand(input: ShellHookInput): string {
  return (input.command ?? input.tool_input?.command ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function expandHome(path: string): string {
  return path
    .replace(/^\$HOME(?=\/|$)/, homedir())
    .replace(/^~(?=\/|$)/, homedir());
}

export function extractGitCwd(command: string): string | undefined {
  const gitCwdMatch = command.match(
    /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/,
  );
  return gitCwdMatch?.[1] ?? gitCwdMatch?.[2] ?? gitCwdMatch?.[3];
}

export function resolveShellHookCwd(input: ShellHookInput): string {
  const command = normalizeShellCommand(input);
  const gitCwd = extractGitCwd(command);
  if (gitCwd) {
    return expandHome(gitCwd);
  }
  return expandHome(
    input.cwd ??
      input.tool_input?.working_directory ??
      input.tool_input?.cwd ??
      input.tool_input?.workdir ??
      process.cwd(),
  );
}
