import { expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
test("chezmoi removes legacy rules and scripts, shares skill definitions, and deploys working CLIs", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-cli-deployment-"));
  const source = join(dir, "source"), target = join(dir, "target");
  mkdirSync(source); mkdirSync(target);
  const copy = (path: string) => cpSync(join(root, path), join(source, path), {
    recursive: true, filter: (path) => !path.split("/").includes("node_modules"),
  });
  try {
    for (const path of [".chezmoiremove", "dot_agents", "dot_claude/skills", "dot_local/lib/agent-cli", "dot_local/lib/x-dm", "dot_local/lib/rpt", "dot_local/lib/web-fetch"]) copy(path);
    mkdirSync(join(source, "dot_local/bin"), { recursive: true });
    for (const name of ["agent-pr", "pr-autofix", "handoff", "x-dm", "rpt", "web-fetch"]) copy(`dot_local/bin/executable_${name}`);
    for (const app of ["claude", "codex", "cursor"]) {
      mkdirSync(join(target, `.${app}/rules`), { recursive: true });
      writeFileSync(join(target, `.${app}/rules/local.md`), "old rule");
      mkdirSync(join(target, `.${app}/skills/pr/scripts`), { recursive: true });
      writeFileSync(join(target, `.${app}/skills/pr/scripts/old.ts`), "old script");
      mkdirSync(join(target, `.${app}/skills/vendor`), { recursive: true });
      writeFileSync(join(target, `.${app}/skills/vendor/SKILL.md`), "vendor-owned");
    }
    mkdirSync(join(target, ".agents/skills/pr/scripts"), { recursive: true });
    writeFileSync(join(target, ".agents/skills/pr/scripts/old.ts"), "old script");
    const config = join(dir, "config.toml"); writeFileSync(config, "");
    const result = Bun.spawnSync(["chezmoi", "--config", config, "--cache", join(dir, "cache"), "--persistent-state", join(dir, "state.db"), "--source", source, "--destination", target, "apply", "--exclude", "scripts", "--force"], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    for (const app of ["claude", "codex", "cursor"]) {
      expect(existsSync(join(target, `.${app}/rules`))).toBe(false);
      expect(readFileSync(join(target, `.${app}/skills/vendor/SKILL.md`), "utf8")).toBe("vendor-owned");
    }
    expect(existsSync(join(target, ".codex/skills/pr"))).toBe(false);
    expect(existsSync(join(target, ".cursor/skills/pr"))).toBe(false);
    expect(existsSync(join(target, ".agents/skills/pr/scripts"))).toBe(false);
    for (const name of ["pr", "pr-autofix", "handoff", "x-dm", "rpt", "web-fetch"]) {
      const link = join(target, `.claude/skills/${name}`);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(realpathSync(link)).toBe(realpathSync(join(target, `.agents/skills/${name}`)));
    }
    for (const name of ["agent-pr", "pr-autofix", "handoff", "x-dm", "rpt", "web-fetch"]) {
      const file = join(target, `.local/bin/${name}`);
      expect(lstatSync(file).mode & 0o111).not.toBe(0);
      const help = Bun.spawnSync([file, "--help"], { cwd: target, stdout: "pipe", stderr: "pipe" });
      expect(help.exitCode, help.stderr.toString()).toBe(0);
      expect(help.stdout.toString()).toContain(name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
