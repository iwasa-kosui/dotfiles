import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

function run(args: string[], cwd: string, env = process.env) {
  const p = Bun.spawnSync(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "agent-cli-test-"));
  temporary.push(dir);
  for (const args of [
    ["init", "-b", "codex/example"], ["config", "user.name", "Fixture"],
    ["config", "user.email", "fixture@example.test"], ["config", "commit.gpgsign", "false"],
    ["config", "core.hooksPath", "/dev/null"],
  ]) expect(run(["git", ...args], dir).code).toBe(0);
  writeFileSync(join(dir, "tracked.txt"), "before\n");
  run(["git", "add", "tracked.txt"], dir);
  expect(run(["git", "commit", "-m", "chore(test): initialize"], dir).code).toBe(0);
  return dir;
}
function cli(name: string, args: string[], cwd: string, env = process.env) {
  return run([process.execPath, join(root, `dot_local/bin/executable_${name}`), ...args], cwd, env);
}

test("CLI help works outside a repository and invalid arguments cause no writes", () => {
  const dir = repo();
  for (const name of ["handoff", "pr-autofix"]) {
    expect(cli(name, ["--help"], tmpdir()).code).toBe(0);
    expect(cli(name, ["unknown-command"], dir).code).toBe(2);
  }
  expect(run(["git", "status", "--porcelain"], dir).out).toBe("");
});

test("handoff writes the supplied brief with Git metadata and never overwrites", () => {
  const dir = repo();
  const output = join(dir, "handoffs");
  const brief = join(dir, "brief.json");
  writeFileSync(brief, JSON.stringify({ title: "引き継ぎ", goal: "CLI に移す", facts: ["検証済みの事実"], pending: ["次の作業"] }));
  const first = cli("handoff", ["write", "--brief", brief, "--out-dir", output], dir);
  expect(first.code, first.err).toBe(0);
  const firstPath = JSON.parse(first.out).path;
  const content = readFileSync(firstPath, "utf8");
  expect(content).toContain("# 引き継ぎ");
  expect(content).toContain("codex/example");
  expect(content).toContain("CLI に移す");
  expect(content).toContain("検証済みの事実");
  expect(content).not.toContain("## 決定と却下案");
  const second = cli("handoff", ["write", "--brief", brief, "--out-dir", output], dir);
  expect(second.code, second.err).toBe(0);
  expect(JSON.parse(second.out).path).not.toBe(firstPath);
  expect(readFileSync(firstPath, "utf8")).toBe(content);
});

test("handoff rejects a malformed brief before writing an output directory", () => {
  const dir = repo();
  writeFileSync(join(dir, "brief.json"), '{"title":42}');
  expect(cli("handoff", ["write", "--brief", "brief.json", "--out-dir", "output"], dir).code).toBe(2);
  expect(run(["git", "status", "--porcelain"], dir).out).not.toContain("output");
});

test("web-fetch help explains errors without accessing the allowlist or network", () => {
  const result = cli("web-fetch", ["--help"], tmpdir());
  expect(result.code, result.err).toBe(0);
  expect(result.out).toContain("web-fetch <url>");
  expect(result.out).toContain("2");
});
