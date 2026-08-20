#!/usr/bin/env bun
// PreToolUse hook: git commit のメッセージが `@` で始まる場合にブロックする。
// PowerShell の here-string `@'...'@` を zsh に渡すと先頭と末尾に `@` が残るため、
// その混入をコミット前に止める。

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import {
  extractCommitMessageSources,
  REASON,
  startsWithAtSign,
} from "./commit-message-guard-lib.ts";
import { readInput } from "./lib.ts";
import {
  normalizeShellCommand,
  resolveShellHookCwd,
} from "./shell-hook-lib.ts";

const input = await readInput<{
  cwd?: string;
  command?: string;
  tool_input?: { command?: string };
}>();
const command = normalizeShellCommand(input);
const cwd = resolveShellHookCwd(input);

function block(): never {
  console.log(JSON.stringify({ decision: "block", reason: REASON }));
  process.exit(0);
}

async function readFileText(path: string): Promise<string | null> {
  // シェル変数やコマンド置換を含むパスは展開前なので読めない
  if (/[$`]/.test(path)) return null;
  const expanded = path.replace(/^~(?=\/|$)/, homedir());
  const file = Bun.file(
    isAbsolute(expanded) ? expanded : resolve(cwd, expanded),
  );
  return (await file.exists()) ? await file.text() : null;
}

for (const source of extractCommitMessageSources(command)) {
  if (source.kind === "inline") {
    if (startsWithAtSign(source.value)) block();
    continue;
  }
  const text = await readFileText(source.path);
  if (text !== null && startsWithAtSign(text)) block();
}
