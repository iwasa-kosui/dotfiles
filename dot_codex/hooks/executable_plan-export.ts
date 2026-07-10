#!/usr/bin/env bun
// PreToolUse hook: ExitPlanMode時にプランをエクスポート

import { readInput } from "./lib.ts";
import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const input = await readInput<{ tool_input?: { plan_file?: string } }>();
const planFile = input.tool_input?.plan_file ?? "";

if (planFile) {
  const file = Bun.file(planFile);
  if (await file.exists()) {
    const exportDir = join(homedir(), ".claude", "plans");
    await mkdir(exportDir, { recursive: true });
    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:]/g, "")
      .slice(0, 15);
    await copyFile(planFile, join(exportDir, `plan_${timestamp}.md`));
  }
}

console.log(JSON.stringify({ decision: "allow" }));
