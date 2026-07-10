#!/usr/bin/env bun
// beforeShellExecution / preToolUse(Shell) hook:
// 保護ブランチ（main/master/develop）で履歴・状態を変更するgitコマンドをブロック

import { readInput } from "./lib.ts";
import { runMainBranchGuard, type BranchGuardInput } from "./branch-guard-lib.ts";

const input = await readInput<BranchGuardInput>();
await runMainBranchGuard(input);
