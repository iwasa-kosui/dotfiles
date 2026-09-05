import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  for (const name of ["agent-pr", "handoff", "pr-autofix"]) {
    expect(cli(name, ["--help"], tmpdir()).code).toBe(0);
    expect(cli(name, ["unknown-command"], dir).code).toBe(2);
  }
  expect(run(["git", "status", "--porcelain"], dir).out).toBe("");
});

test("agent-pr context reports the actual checkout and changed paths", () => {
  const dir = repo();
  writeFileSync(join(dir, "tracked.txt"), "after\n");
  const result = cli("agent-pr", ["context"], dir);
  expect(result.code, result.err).toBe(0);
  const context = JSON.parse(result.out);
  expect(context.branch).toBe("codex/example");
  expect(context.status).toContain("tracked.txt");
  expect(context.diff).toContain("+after");
});

test("agent-pr commit preserves literal message text and commits only explicit paths", () => {
  const dir = repo();
  writeFileSync(join(dir, "tracked.txt"), "after\n");
  writeFileSync(join(dir, "unrelated.txt"), "keep me unstaged");
  const message = join(dir, "message.md");
  writeFileSync(message, "refactor(cli): preserve text\n\nLiteral `code` and $(do-not-run).\n");
  const result = cli("agent-pr", ["commit", "--message-file", message, "--model", "Test Model", "--email", "noreply@example.test", "--", "tracked.txt"], dir);
  expect(result.code, result.err).toBe(0);
  const log = run(["git", "log", "-1", "--format=%B"], dir).out;
  expect(log).toContain("Literal `code` and $(do-not-run).");
  expect(log).toContain("Co-Authored-By: Test Model <noreply@example.test>");
  expect(run(["git", "show", "--format=", "--name-only", "HEAD"], dir).out.trim()).toBe("tracked.txt");
  expect(run(["git", "status", "--porcelain"], dir).out).toContain("?? unrelated.txt");
});

test("agent-pr refuses to include an unrelated staged file", () => {
  const dir = repo();
  writeFileSync(join(dir, "other.txt"), "other");
  run(["git", "add", "other.txt"], dir);
  const msg = join(dir, "msg.md");
  writeFileSync(msg, "fix(cli): validate stage");
  const before = run(["git", "rev-parse", "HEAD"], dir).out;
  expect(cli("agent-pr", ["commit", "--message-file", msg, "--", "tracked.txt"], dir).code).toBe(2);
  expect(run(["git", "rev-parse", "HEAD"], dir).out).toBe(before);
});

test("agent-pr rejects option-like paths before staging", () => {
  const dir = repo();
  writeFileSync(join(dir, "msg.md"), "fix(cli): validate paths");
  expect(cli("agent-pr", ["commit", "--message-file", "msg.md", "--", "."], dir).code).toBe(2);
  expect(run(["git", "diff", "--cached", "--name-only"], dir).out).toBe("");
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

test("agent-pr publish creates only a Draft and updates an existing PR without recreation", () => {
  const dir = repo();
  const remote = join(dir, "remote.git");
  expect(run(["git", "init", "--bare", remote], dir).code).toBe(0);
  run(["git", "remote", "add", "origin", "https://github.com/test/repo.git"], dir);
  run(["git", "config", `url.${remote}.insteadOf`, "https://github.com/test/repo.git"], dir);
  const bin = join(dir, "bin"); mkdirSync(bin);
  // Redirect the actual Git push to the local bare fixture while retaining GitHub URL metadata.
  const git = Bun.which("git")!;
  writeFileSync(join(bin, "git"), `#!${process.execPath}\nconst a=process.argv.slice(2);\nif(a.join(' ')==='remote get-url --push --all origin') console.log('https://github.com/test/repo.git');\nelse process.exit(Bun.spawnSync([${JSON.stringify(git)},...a],{stdin:'inherit',stdout:'inherit',stderr:'inherit'}).exitCode);\n`, { mode: 0o755 });
  const calls = join(dir, "calls.jsonl");
  const fixture = join(dir, "existing.json"); writeFileSync(fixture, "[]");
  writeFileSync(join(bin, "gh"), `#!${process.execPath}\nimport { appendFileSync, readFileSync } from 'node:fs';\nconst a=process.argv.slice(2); appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');\nif(a[1]==='list') console.log(readFileSync(${JSON.stringify(fixture)},'utf8'));\nelse if(a[1]==='create'||a[1]==='edit') console.log('https://github.com/test/repo/pull/1');\nelse process.exit(9);\n`, { mode: 0o755 });
  const env = { ...process.env, GH_REPO: "wrong/repository", PATH: `${bin}:${process.env.PATH}` };
  const body = join(dir, "body.md"); writeFileSync(body, "本文\n`literal` $(stay-literal)");
  const args = ["publish", "--base", "main", "--title", "refactor(cli): simplify", "--body-file", body];
  const created = cli("agent-pr", args, dir, env);
  expect(created.code, created.err).toBe(0);
  expect(created.out).toContain("https://github.com/test/repo/pull/1");
  expect(run(["git", "--git-dir", remote, "rev-parse", "codex/example"], dir).out).toBe(run(["git", "rev-parse", "HEAD"], dir).out);
  let requests = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
  expect(requests.find((a) => a[1] === "create")).toContain("--draft");
  expect(requests.find((a) => a[1] === "create")).toContain(body);
  expect(requests.every((a) => a.includes("--repo") && a.includes("github.com/test/repo"))).toBe(true);
  writeFileSync(fixture, '[{"url":"https://github.com/test/repo/pull/1","headRepositoryOwner":{"login":"test"},"headRepository":{"name":"repo"},"headRefName":"codex/example"}]');
  writeFileSync(calls, "");
  const updated = cli("agent-pr", args, dir, env);
  expect(updated.code, updated.err).toBe(0);
  requests = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
  expect(requests.some((a) => a[1] === "edit")).toBe(true);
  expect(requests.find((a) => a[1] === "edit")).toContain("--base");
  expect(requests.some((a) => a[1] === "create" || a[1] === "ready")).toBe(false);
});


test("web-fetch help explains errors without accessing the allowlist or network", () => {
  const result = cli("web-fetch", ["--help"], tmpdir());
  expect(result.code, result.err).toBe(0);
  expect(result.out).toContain("web-fetch <url>");
  expect(result.out).toContain("2");
});


test("agent-pr cannot stage deletions recursively through a missing directory", () => {
  const dir = repo(); mkdirSync(join(dir, "old"));
  writeFileSync(join(dir, "old/a.txt"), "a"); writeFileSync(join(dir, "old/b.txt"), "b");
  run(["git", "add", "old"], dir); run(["git", "commit", "-m", "chore(test): files"], dir);
  rmSync(join(dir, "old"), { recursive: true });
  writeFileSync(join(dir, "message.md"), "refactor(test): remove old files");
  const before = run(["git", "rev-parse", "HEAD"], dir).out;
  const result = cli("agent-pr", ["commit", "--message-file", "message.md", "--", "old"], dir);
  expect(result.code, result.err).toBe(2);
  expect(run(["git", "rev-parse", "HEAD"], dir).out).toBe(before);
  expect(run(["git", "diff", "--cached", "--name-only"], dir).out).toBe("");
});

test("agent-pr treats a path named --help as a literal file after --", () => {
  const dir = repo(); writeFileSync(join(dir, "--help"), "literal path");
  writeFileSync(join(dir, "message.md"), "feat(test): commit literal path");
  const result = cli("agent-pr", ["commit", "--message-file", "message.md", "--", "--help"], dir);
  expect(result.code, result.err).toBe(0);
  expect(run(["git", "show", "HEAD:--help"], dir).out).toBe("literal path");
});

test("agent-pr commits an explicitly requested staged deletion", () => {
  const dir = repo();
  expect(run(["git", "rm", "tracked.txt"], dir).code).toBe(0);
  writeFileSync(join(dir, "message.md"), "refactor(test): remove tracked file");
  const result = cli("agent-pr", ["commit", "--message-file", "message.md", "--", "tracked.txt"], dir);
  expect(result.code, result.err).toBe(0);
  expect(run(["git", "diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"], dir).out).toBe("D\ttracked.txt\n");
});

test("agent-pr rejects a different origin push repository before contacting GitHub", () => {
  const dir = repo();
  run(["git", "remote", "add", "origin", "https://github.com/test/repo.git"], dir);
  run(["git", "config", "remote.origin.pushurl", "https://github.com/wrong/repo.git"], dir);
  writeFileSync(join(dir, "body.md"), "Test body");
  const bin = join(dir, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!${process.execPath}\nconsole.error('GitHub must not be contacted'); process.exit(9);\n`, { mode: 0o755 });
  const result = cli("agent-pr", ["publish", "--title", "test", "--body-file", "body.md"], dir, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  expect(result.code, result.err).toBe(2);
  expect(result.err).toContain("origin push URL");
});
