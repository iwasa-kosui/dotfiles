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

function managedSkillPaths(runtimeName: "claude" | "codex" | "cursor") {
  const root = manifest.runtimes[runtimeName].skills;
  return [...new Bun.Glob("**/SKILL.md").scanSync({ cwd: root })]
    .map((path) => `${root}/${path}`)
    .sort();
}

describe("agent runtime contract", () => {
  test("defines all supported runtimes and Draft ship policy", async () => {
    expect(Object.keys(manifest.runtimes).sort()).toEqual(["claude", "codex", "cursor"]);
    const policy = await Bun.file("agent_policy/contract.md").text();
    expect(policy).toContain("Draft PR");
    expect(policy).toContain("Ready 化");
  });

  test("keeps the Cursor adapter at the Draft PR stage", async () => {
    const policy = await Bun.file("agent_policy/contract.md").text();
    const cursorPolicy = await Bun.file("dot_cursor/rules/auto-ship.mdc").text();
    expect(policy).toContain("Draft PR まで");
    expect(cursorPolicy).toMatch(/draft PR まで/i);
  });

  test("keeps Claude and Cursor managed paths in the repository", () => {
    for (const runtime of ["claude", "cursor"]) {
      const { rules, skills, hooks } = manifest.runtimes[runtime];

      for (const path of [rules, skills, hooks]) {
        expect(existsSync(path)).toBe(true);
      }
    }
  });

  test("manifest assigns hook, rule, and subagent responsibilities to every runtime", () => {
    for (const runtime of Object.values(manifest.runtimes)) {
      expect(Object.keys(runtime.responsibilities ?? {}).sort()).toEqual([
        "hooks",
        "rules",
        "subagents",
      ]);
      for (const responsibility of Object.values(runtime.responsibilities ?? {})) {
        expect(responsibility).toBeString();
        expect(responsibility.length).toBeGreaterThan(0);
      }
      for (const role of Object.values(runtime.hookRoles ?? {})) {
        expect(existsSync(role.path), role.path).toBe(true);
        expect(["active", "deferred"]).toContain(role.status);
        expect(role.responsibility).toBeString();
        expect(role.responsibility.length).toBeGreaterThan(0);
      }
    }
  });

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

  test("Codex instructions have managed rules and no Claude-only execution API", async () => {
    const instructions = await Bun.file("dot_codex/AGENTS.md").text();
    expect(instructions).not.toContain("CLAUDE_CODE_SUBAGENT_MODEL");
    expect(instructions).not.toContain("@RTK.md");
    expect(instructions).toContain("~/.codex/rules/");
    for (const rule of manifest.runtimes.codex.requiredRules) {
      expect(await Bun.file(`dot_codex/rules/${rule}`).exists()).toBe(true);
    }
  });

  test("Codex worktree rule avoids unverified settings-local sharing assertions", async () => {
    const worktreeRule = await Bun.file("dot_codex/rules/worktree-workflow.md").text();
    expect(worktreeRule).not.toContain("symlink");
    expect(worktreeRule).not.toContain("全worktreeで共有");
    expect(worktreeRule).not.toContain("許可はメイン側に蓄積");
  });

  test("requires explicit approval after a Draft PR in the common and Cursor policies", async () => {
    const policy = await Bun.file("agent_policy/contract.md").text();
    const cursorPolicy = await Bun.file("dot_cursor/rules/auto-ship.mdc").text();

    for (const source of [policy, cursorPolicy]) {
      expect(source).toContain("Ready 化");
      expect(source).toContain("merge");
      expect(source).toContain("force-push");
      expect(source).toContain("保護ブランチへの直接変更");
      expect(source).toContain("明示的な承認");
    }
  });

  test("all runtime policy adapters preserve every Draft ship boundary", async () => {
    for (const path of [
      "dot_codex/AGENTS.md",
      "dot_cursor/rules/auto-ship.mdc",
      "dot_claude/CLAUDE.md",
    ]) {
      const text = await Bun.file(path).text();
      expect(text).toContain("Draft PR");
      expect(text).toContain("明示的な承認");
      expect(text).toContain("Ready 化");
      expect(text).toContain("merge");
      expect(text).toContain("force-push");
      expect(text).toContain("保護ブランチへの直接変更");
      expect(text).toMatch(/質問[^。\n]*ship しません/);
      expect(text).toMatch(/調査[^。\n]*ship しません/);
      expect(text).toMatch(/コードレビュー[^。\n]*ship しません/);
    }
  });

  test("all runtime secret-file policies describe the same protected path set", async () => {
    for (const path of [
      "dot_codex/rules/secret-file-access.md",
      "dot_cursor/rules/secret-file-access.mdc",
      "dot_claude/rules/secret-file-access.md",
    ]) {
      const text = await Bun.file(path).text();
      for (const protectedPath of [
        "credential",
        "secret",
        "password",
        "apikey",
        "api_key",
        "_token",
        ".env",
        "*.pem",
        "*.p12",
        "*.pfx",
        "*.jks",
        "*.keystore",
        "id_rsa*",
        "id_ed25519*",
        "id_ecdsa*",
        "id_dsa*",
        "~/.aws/**",
        "~/.ssh/**",
        "~/.gnupg/**",
        "~/.kube/**",
        "~/.npmrc",
        "~/.netrc",
        "~/.docker/config.json",
        "~/.config/gh/hosts.yml",
        "~/.config/confluence-cli/**",
        "~/.config/jira-cli/**",
        "~/.local/state/**",
        "~/.zshrc_local",
      ]) {
        expect(text).toContain(protectedPath);
      }
    }
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

  test("Codex and Cursor adapters do not hard-code Claude runtime state", async () => {
    const files = [
      "dot_codex/skills/pr/SKILL.md",
      "dot_codex/skills/pr-autofix/SKILL.md",
      "dot_cursor/skills/pr/SKILL.md",
      "dot_cursor/skills/pr-autofix/SKILL.md",
      "dot_codex/hooks/executable_plan-export.ts",
      "dot_codex/hooks/executable_worktree.ts",
    ];
    for (const path of files) {
      expect(await Bun.file(path).text()).not.toContain("~/.claude");
    }
  });

  test("runtime skills use their manifest home with exact casing", async () => {
    const runtimeHomes = Object.values(manifest.runtimes).map((runtime) => runtime.home);

    for (const runtimeName of ["claude", "codex", "cursor"] as const) {
      const expectedHome = manifest.runtimes[runtimeName].home;
      for (const path of managedSkillPaths(runtimeName)) {
        const text = await Bun.file(path).text();
        const referencedHomes = [...text.matchAll(/~\/\.[A-Za-z]+/g)]
          .map((match) => match[0])
          .filter((home) =>
            runtimeHomes.some(
              (runtimeHome) => runtimeHome.toLowerCase() === home.toLowerCase(),
            ),
          );
        for (const referencedHome of referencedHomes) {
          expect(referencedHome, path).toBe(expectedHome);
        }
        expect(text).not.toMatch(/Generated with (?:Codex|Claude Code|Cursor)/);
        expect(text).not.toMatch(
          /<summary>🤖 (?:Codex|Claude Code|Cursor)<\/summary>/,
        );
      }
    }
  });

  test("PR skill templates name the agent that actually executes them", async () => {
    for (const path of [
      "dot_claude/skills/pr/SKILL.md",
      "dot_codex/skills/pr/SKILL.md",
      "dot_cursor/skills/pr/SKILL.md",
    ]) {
      const text = await Bun.file(path).text();
      expect(text).toContain("Generated with <実行中のエージェント名>");
      expect(text).not.toMatch(/Generated with (?:Codex|Claude Code|Cursor)/);
    }

    for (const path of [
      "dot_claude/skills/pr-autofix/SKILL.md",
      "dot_codex/skills/pr-autofix/SKILL.md",
      "dot_cursor/skills/pr-autofix/SKILL.md",
    ]) {
      const text = await Bun.file(path).text();
      expect(text).toContain(
        "<summary>🤖 <実行中のエージェント名></summary>",
      );
      expect(text).not.toMatch(
        /<summary>🤖 (?:Codex|Claude Code|Cursor)<\/summary>/,
      );
    }
  });

  test("repository metadata describes the deployed integration and hook set", async () => {
    const instructions = await Bun.file("AGENTS.md").text();
    expect(instructions).toContain("`claudecode.lua` - Claude Code integration");
    expect(existsSync("dot_codex/hooks/readonly_dot_rtk-hook.sha256")).toBe(false);
  });
});
