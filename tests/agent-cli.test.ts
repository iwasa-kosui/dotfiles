import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("handoff writes failed, questions and references sections in order", () => {
  const dir = repo();
  const brief = join(dir, "brief.json");
  writeFileSync(brief, JSON.stringify({
    title: "引き継ぎ", goal: "目的", facts: ["事実A"], decisions: ["決定B"], failed: ["失敗C"],
    pending: ["未完了D"], questions: ["質問E"], references: ["参照F"], resume: "再開G",
  }));
  const result = cli("handoff", ["write", "--brief", brief, "--out-dir", join(dir, "handoffs")], dir);
  expect(result.code, result.err).toBe(0);
  const content = readFileSync(JSON.parse(result.out).path, "utf8");
  const headings = ["# 引き継ぎ", "## ゴール", "## 確定した事実", "## 決定と却下案", "## 失敗した試み", "## 未完了の作業", "## ユーザーに確かめること", "## 参照先", "## 再開手順"];
  const positions = headings.map((h) => content.indexOf(h));
  expect(positions.every((i) => i >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  for (const item of ["失敗C", "質問E", "参照F"]) expect(content).toContain(`- ${item}`);
});

const secrets: [string, string, string][] = [
  ["GitHub token (ghp_)", "GitHub token (ghp_)", "ghp_" + "A1b2C3d4E5".repeat(3)],
  ["GitHub token (github_pat_)", "GitHub token (github_pat_)", "github_pat_" + "A1b2C3d4E5_".repeat(3)],
  ["API key (sk-)", "API key (sk-)", "sk-" + "A1b2C3d4E5".repeat(3)],
  ["AWS access key", "AWS access key", "AKIA" + "0123456789ABCDEF"],
  ["AWS access key (ASIA)", "AWS access key", "ASIA" + "0123456789ABCDEF"],
  ["Slack token", "Slack token", "xoxb-" + "0123456789-abcdef"],
  ["Slack token (xoxe-)", "Slack token", "xoxe-" + "0123456789-abcdef"],
  ["npm token", "npm token", "npm_" + "A1b2C3d4E5".repeat(3) + "A1b2C3"],
  ["Google API key", "Google API key", "AIza" + "A1b2C3d4E5".repeat(3) + "A1b2C"],
  ["URL credentials", "URL credentials", "https" + "://" + "deploy" + ":" + "hunter2pass" + "@" + "example.test"],
  ["Private key", "Private key", "-----BEGIN " + "RSA PRIVATE KEY-----"],
];
const listFields = ["facts", "decisions", "failed", "pending", "questions", "references"];
for (const [name, expected, value] of secrets) {
  test(`handoff rejects a brief containing a ${name} before writing an output directory`, () => {
    const dir = repo();
    const output = join(dir, "output");
    const briefs: Record<string, unknown>[] = [
      { title: `引き継ぎ ${value}`, goal: "目的" },
      { title: "引き継ぎ", goal: `目的 ${value}` },
      { title: "引き継ぎ", goal: "目的", resume: `再開 ${value}` },
      ...listFields.map((field) => ({ title: "引き継ぎ", goal: "目的", [field]: ["ok", `項目 ${value}`] })),
    ];
    for (const brief of briefs) {
      writeFileSync(join(dir, "brief.json"), JSON.stringify(brief));
      const result = cli("handoff", ["write", "--brief", "brief.json", "--out-dir", output], dir);
      expect(result.code, JSON.stringify(Object.keys(brief))).toBe(2);
      expect(result.err).toContain(expected);
      expect(result.err).not.toContain(value);
      expect(existsSync(output)).toBe(false);
    }
  });
}

test("handoff does not flag identifiers that merely contain sk-", () => {
  const dir = repo();
  const names = ["feat/disk-usage-monitoring-dashboard", "dot_agents/skills/task-runner-orchestration-skill", "risk-assessment-for-production-rollout"];
  for (const field of ["references", "pending"]) {
    writeFileSync(join(dir, "brief.json"), JSON.stringify({ title: "引き継ぎ", goal: "目的", [field]: names }));
    const result = cli("handoff", ["write", "--brief", "brief.json", "--out-dir", join(dir, `out-${field}`)], dir);
    expect(result.code, result.err).toBe(0);
  }
});

test("web-fetch help explains errors without accessing the allowlist or network", () => {
  const result = cli("web-fetch", ["--help"], tmpdir());
  expect(result.code, result.err).toBe(0);
  expect(result.out).toContain("web-fetch <url>");
  expect(result.out).toContain("2");
});
