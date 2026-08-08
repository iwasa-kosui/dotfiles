// シェル系 hook の共通ユーティリティ。
// dot_claude/hooks/ dot_codex/hooks/ dot_cursor/hooks/ の3箇所で同一内容を保つこと。
// 内容がずれると保護の抜け穴になるため tests/branch-guard-lib.test.ts が一致を検証する。

import { homedir } from "node:os";
import { resolve } from "node:path";

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

type ShellPathToken = {
  value: string;
  quote: "unquoted" | "single" | "double";
};

function toShellPathToken(
  match: RegExpMatchArray | null,
): ShellPathToken | undefined {
  if (match?.[1] !== undefined) {
    return { value: match[1], quote: "double" };
  }
  if (match?.[2] !== undefined) {
    return { value: match[2], quote: "single" };
  }
  if (match?.[3] !== undefined) {
    return { value: match[3], quote: "unquoted" };
  }
  return undefined;
}

function extractGitCwdToken(command: string): ShellPathToken | undefined {
  return toShellPathToken(
    command.match(/\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/),
  );
}

export function extractGitCwd(command: string): string | undefined {
  return extractGitCwdToken(command)?.value;
}

function extractLeadingCdCwdToken(command: string): ShellPathToken | undefined {
  return toShellPathToken(
    command.match(
      /^\s*cd\s+(?:--\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*&&/,
    ),
  );
}

function expandStaticShellPath(token: ShellPathToken): string | undefined {
  let path = token.value;

  if (token.quote !== "single") {
    if (path.includes("\\")) {
      return undefined;
    }
    const afterAllowedHome = path.replace(/^\$HOME(?=\/|$)/, "");
    if (/[$`]/.test(afterAllowedHome)) {
      return undefined;
    }
    path = path.replace(/^\$HOME(?=\/|$)/, homedir());
  }

  if (token.quote === "unquoted") {
    if (/[*?\[\]{}<>'"]/.test(path)) {
      return undefined;
    }
    path = path.replace(/^~(?=\/|$)/, homedir());
    if (path.startsWith("~")) {
      return undefined;
    }
  }

  return path;
}

export function resolveShellHookCwd(input: ShellHookInput): string {
  const rawCommand = input.command ?? input.tool_input?.command ?? "";
  const inputCwd = expandHome(
    input.cwd ??
      input.tool_input?.working_directory ??
      input.tool_input?.cwd ??
      input.tool_input?.workdir ??
      process.cwd(),
  );

  const gitCwdToken = extractGitCwdToken(rawCommand);
  if (gitCwdToken) {
    const gitCwd = expandStaticShellPath(gitCwdToken);
    return gitCwd ? resolve(inputCwd, gitCwd) : inputCwd;
  }

  const leadingCdCwdToken = extractLeadingCdCwdToken(rawCommand);
  if (leadingCdCwdToken) {
    const leadingCdCwd = expandStaticShellPath(leadingCdCwdToken);
    return leadingCdCwd ? resolve(inputCwd, leadingCdCwd) : inputCwd;
  }

  return inputCwd;
}
