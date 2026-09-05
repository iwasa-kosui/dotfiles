import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const manifest = await Bun.file("agent_policy/runtime-manifest.json").json();

async function runHook(path: string, input: unknown) {
  const process = Bun.spawn(["bun", path], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stdin.write(JSON.stringify(input));
  process.stdin.end();

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

async function registeredHookRoleNames(path: string) {
  const config = await Bun.file(path).text();
  return [
    ...new Set(
      [...config.matchAll(/bun\s+(?:~\/\.(?:codex|claude)\/hooks\/|\.\/hooks\/)([\w-]+)\.ts/g)]
        .map((match) => match[1]),
    ),
  ].sort();
}

describe("agent runtime contract", () => {
  test("manifest active hook roles exactly match each runtime registration", async () => {
    for (const runtime of Object.values(manifest.runtimes)) {
      const registered = await registeredHookRoleNames(runtime.hooks);
      const active = Object.values(runtime.hookRoles ?? {})
        .filter((role) => role.status === "active")
        .map((role) => basename(role.path, ".ts").replace(/^executable_/, ""))
        .sort();
      expect(active, runtime.home).toEqual(registered);
    }
  });

  test("keeps the unregistered Codex worktree hook explicitly deferred", async () => {
    const worktree = manifest.runtimes.codex.hookRoles.worktree;
    expect(worktree.status).toBe("deferred");
    expect(worktree.owner).toBeString();
    expect(worktree.owner.length).toBeGreaterThan(0);
    expect(worktree.reason).toContain("未登録");
    expect(
      await registeredHookRoleNames(manifest.runtimes.codex.hooks),
    ).not.toContain("worktree");
  });

  test("Codex and Cursor secret-file hooks deny protected fictional paths", async () => {
    const paths = [
      "~/.zshrc_local",
      "$HOME/.config/confluence-cli/config.json",
      "~/.config/jira-cli/config.yml",
      "$HOME/.local/state/example-agent/session.json",
      "~/.aws/credentials",
      "$HOME/.ssh/id_example",
      "~/.gnupg/pubring.kbx",
      "$HOME/.kube/config",
      "~/.npmrc",
      "$HOME/.netrc",
      "~/.docker/config.json",
      "$HOME/.config/gh/hosts.yml",
      "/tmp/agent-hook-fixture/project/.env.example",
      "/tmp/agent-hook-fixture/project/service-credential.json",
      "/tmp/agent-hook-fixture/project/server.pem",
      "/tmp/agent-hook-fixture/project/id_ed25519-example",
      "/tmp/agent-hook-fixture/project/access_token.txt",
    ];

    for (const filePath of paths) {
      const codex = await runHook(
        "dot_codex/hooks/executable_secret-file-guard.ts",
        { tool_input: { file_path: filePath } },
      );
      expect(codex.decision, `Codex allowed ${filePath}`).toBe("block");

      const cursor = await runHook(
        "dot_cursor/hooks/executable_secret-file-guard.ts",
        { file_path: filePath, cwd: "/tmp/agent-hook-fixture" },
      );
      expect(cursor.permission, `Cursor allowed ${filePath}`).toBe("deny");
    }
  });
});
