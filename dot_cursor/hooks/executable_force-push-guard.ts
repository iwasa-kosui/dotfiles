#!/usr/bin/env bun
// beforeShellExecution / preToolUse(Shell) hook: git push の force 系オプションをブロック

import { readInput } from "./lib.ts";
import { allowResponse, denyResponse } from "./repo-guard-lib.ts";
import {
  GIT_PREFIX,
  normalizeShellCommand,
  type ShellHookInput,
} from "./shell-hook-lib.ts";

const input = await readInput<ShellHookInput>();
const command = normalizeShellCommand(input);

const gitPush = new RegExp(`${GIT_PREFIX.source}push\\b`);
if (!gitPush.test(command)) {
  allowResponse();
  process.exit(0);
}

const forceFlag = new RegExp(
  `${GIT_PREFIX.source}push\\b[^;&|]*(--force-with-lease|--force\\b|-f\\b)`,
);
const forceRefspec = new RegExp(`${GIT_PREFIX.source}push\\s+\\S+\\s+\\+`);

if (!forceFlag.test(command) && !forceRefspec.test(command)) {
  allowResponse();
  process.exit(0);
}

const reason =
  "force push（--force, --force-with-lease, -f, +refspec）は禁止されています。履歴の書き換えではなく、新しいコミットで対応してください。";
denyResponse(reason);
