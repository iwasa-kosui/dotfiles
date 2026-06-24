#!/usr/bin/env bun
// beforeShellExecution hook: git push の force 系オプションをブロック

import { readInput } from "./lib.ts";

type BeforeShellInput = {
  command?: string;
};

const input = await readInput<BeforeShellInput>();
const command = input.command ?? "";

if (!/\bgit\s+push\b/.test(command)) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

// git push を含むセグメント内で force フラグを検出
const forceFlag = /\bgit\s+push\b[^;&|]*(--force-with-lease|--force\b|-f\b)/;
const forceRefspec = /\bgit\s+push\s+\S+\s+\+/;

if (!forceFlag.test(command) && !forceRefspec.test(command)) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

const reason =
  "force push（--force, --force-with-lease, -f, +refspec）は禁止されています。履歴の書き換えではなく、新しいコミットで対応してください。";

console.log(
  JSON.stringify({
    permission: "deny",
    user_message: reason,
    agent_message: reason,
  }),
);
