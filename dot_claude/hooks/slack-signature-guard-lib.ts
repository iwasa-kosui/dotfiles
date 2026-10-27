import { allow, deny, type GuardInput, type GuardResult } from "./guard-lib.ts";

const SIGNATURE_LINE = "🤖 Claude Code";
const REASON =
  "slack-cli の send / edit は本文の最後の行を「🤖 Claude Code」にする。例: -m $'本文\\n\\n🤖 Claude Code'";
const POSTING_SUBCOMMANDS = new Set(["send", "edit"]);

function isSlackCli(token: string): boolean {
  return token === "slack-cli" || token.endsWith("/slack-cli");
}

function findSubcommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token.startsWith("-")) continue;
    const previous = args[i - 1];
    const isOptionValue =
      previous !== undefined &&
      previous.startsWith("-") &&
      !previous.includes("=");
    if (isOptionValue && !POSTING_SUBCOMMANDS.has(token)) continue;
    return token;
  }
  return undefined;
}

export function isSlackPostingCommand(command: string): boolean {
  return command.split(/[;&|]/).some((segment) => {
    const tokens = segment.split(" ").filter(Boolean);
    const start = tokens.findIndex((token) => isSlackCli(token));
    if (start === -1) return false;
    const subcommand = findSubcommand(tokens.slice(start + 1));
    return subcommand !== undefined && POSTING_SUBCOMMANDS.has(subcommand);
  });
}

export function checkSlackSignature(input: GuardInput): GuardResult {
  if (!isSlackPostingCommand(input.normalizedCommand)) return allow;
  if (input.command.includes(SIGNATURE_LINE)) return allow;
  return deny(REASON);
}
