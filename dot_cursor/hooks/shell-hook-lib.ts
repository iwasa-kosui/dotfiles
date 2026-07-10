import { expandHome } from "./repo-guard-lib.ts";

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

// git の直後に -C 等のオプションが挟まってもマッチする接頭辞
export const GIT_PREFIX = /\bgit(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+/;

export function normalizeShellCommand(input: ShellHookInput): string {
  return (input.command ?? input.tool_input?.command ?? "")
    .replace(/\s+/g, " ")
    .trim();
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
