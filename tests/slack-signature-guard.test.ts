import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isSlackPostingCommand } from "../dot_claude/hooks/slack-signature-guard-lib.ts";

const hookPath = join(
  import.meta.dir,
  "..",
  "dot_claude/hooks/executable_bash-guard.ts",
);

function runHook(command: string, cwd: string): string | null {
  const stdout = execFileSync("bun", [hookPath], {
    input: JSON.stringify({
      cwd,
      agent_id: "test-subagent",
      tool_input: { command },
    }),
    encoding: "utf8",
  });
  if (stdout.trim() === "") return null;
  return (
    (
      JSON.parse(stdout) as {
        hookSpecificOutput?: { permissionDecision?: string };
      }
    ).hookSpecificOutput?.permissionDecision ?? null
  );
}

describe("投稿系の slack-cli コマンドを判定する", () => {
  test.each([
    ["send", "slack-cli send -c C123 -m 本文"],
    ["edit", "slack-cli edit -c C123 -t 1.2 -m 本文"],
    ["--profile を挟む", "slack-cli --profile work send -c C123 -m 本文"],
    ["&& の後ろ", "cd /tmp && slack-cli send -c C123 -m 本文"],
    ["; の後ろ", "echo a; slack-cli edit -c C123 -t 1.2 -m 本文"],
    ["フルパス", "/opt/homebrew/bin/slack-cli send -c C123 -m 本文"],
  ])("%s", (_name, command) => {
    expect(isSlackPostingCommand(command)).toBe(true);
  });
});

describe("投稿系ではないコマンドは対象外にする", () => {
  test.each([
    ["history", "slack-cli history -c C123"],
    ["search", "slack-cli search 本文"],
    ["--profile 付きの history", "slack-cli --profile work history -c C123"],
    ["slack-cli を含まない", "git status"],
  ])("%s", (_name, command) => {
    expect(isSlackPostingCommand(command)).toBe(false);
  });
});

describe("hook 本体", () => {
  test("署名なしの send をブロックする", () => {
    expect(runHook("slack-cli send -c C123 -m '本文'", tmpdir())).toBe("deny");
  });

  test("署名ありの send は許可する", () => {
    expect(
      runHook("slack-cli send -c C123 -m $'本文\\n\\n🤖 Claude Code'", tmpdir()),
    ).toBeNull();
  });

  test("署名なしの edit をブロックする", () => {
    expect(
      runHook(
        "slack-cli edit -c C123 -t 1700000000.000100 -m '本文'",
        tmpdir(),
      ),
    ).toBe("deny");
  });

  test("--profile 付きで署名なしの send をブロックする", () => {
    expect(
      runHook("slack-cli --profile work send -c C123 -m '本文'", tmpdir()),
    ).toBe("deny");
  });

  test("&& の後半にある署名なしの send をブロックする", () => {
    expect(
      runHook("cd /tmp && slack-cli send -c C123 -m '本文'", tmpdir()),
    ).toBe("deny");
  });

  test("history は許可する", () => {
    expect(runHook("slack-cli history -c C123", tmpdir())).toBeNull();
  });
});
