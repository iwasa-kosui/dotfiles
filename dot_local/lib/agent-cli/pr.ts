import { parseArgs } from "node:util";
import { isAbsolute, relative, resolve } from "node:path";
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { checked, CliError, command, fail, nonemptyFile } from "./process.ts";

const HELP = `Usage: agent-pr <command> [options]

  context [--base <ref>]
    Print JSON with branch, status, diff, commits, and PR template paths.
  commit --message-file <file> [--model <name> --email <address>] -- <file>...
    Commit only the explicit paths. Message is read literally from the file.
  publish --title <title> --body-file <file> [--base <branch>] [--repo <owner/repo>]
    Push the current branch, then create a Draft PR or update its open PR.

Run in the target Git checkout. gh and git must be installed.
context does not access GitHub. publish does not merge or mark a PR ready.
publish derives the GitHub repository from origin. For a fork PR, pass its base --repo.
GH_REPO and gh's default repository never select the publication target.
Exit codes: 0 success, 1 command failure, 2 invalid input.
`;

function branch(): string {
  const name = checked(["git", "branch", "--show-current"]);
  if (!name) throw new CliError("Detached HEAD: check out a branch first");
  return name;
}
function writableBranch(): string {
  const name = branch();
  if (["main", "master", "develop"].includes(name)) throw new CliError("Check out a feature branch first");
  return name;
}

async function context(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, options: { base: { type: "string" } }, allowPositionals: true, strict: true });
  if (positionals.length) throw new CliError("context takes no positional arguments");
  const root = checked(["git", "rev-parse", "--show-toplevel"]);
  const base = values.base ?? command(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).out;
  if (base?.startsWith("-")) throw new CliError("Invalid base ref");
  const baseExists = base && command(["git", "rev-parse", "--verify", `${base}^{commit}`]).code === 0;
  if (values.base && !baseExists) throw new CliError(`Base ref does not exist: ${base}`);
  const templates: string[] = [];
  for (const pattern of ["[Pp][Uu][Ll][Ll]_[Rr][Ee][Qq][Uu][Ee][Ss][Tt]_[Tt][Ee][Mm][Pp][Ll][Aa][Tt][Ee]*", ".github/**/*", "docs/*"]) {
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true, dot: true })) {
      if (/pull_request_template/i.test(path)) templates.push(path);
    }
  }
  console.log(JSON.stringify({
    root, branch: branch(), base: baseExists ? base : null,
    status: checked(["git", "status", "--short"]),
    diff: checked(["git", "diff", "HEAD", "--"]),
    branchDiff: baseExists ? checked(["git", "diff", `${base}...HEAD`, "--"]) : "",
    commits: baseExists ? checked(["git", "log", "--oneline", `${base}..HEAD`, "--"]) : "",
    templates: [...new Set(templates)],
  }, null, 2));
}

async function commit(argv: string[]) {
  const separator = argv.indexOf("--");
  if (separator < 0) throw new CliError("Separate explicit file paths with --");
  const files = argv.slice(separator + 1);
  const { values } = parseArgs({ args: argv.slice(0, separator), strict: true, options: {
    "message-file": { type: "string" }, model: { type: "string" }, email: { type: "string" },
  } });
  writableBranch();
  const root = checked(["git", "rev-parse", "--show-toplevel"]);
  if (!files.length) throw new CliError("At least one explicit file is required");
  const tracked = new Set(checked(["git", "ls-files", "-z"], root).split("\0"));
  const deleted = new Set(checked(["git", "diff", "--cached", "--name-only", "--no-renames", "--diff-filter=D", "-z"], root).split("\0"));
  const alreadyDeleted = new Set<string>();
  const names = files.map((file) => {
    const full = resolve(file), name = relative(root, full);
    if (!name || name === ".." || name.startsWith("../") || isAbsolute(name) || file.startsWith(":")) throw new CliError(`Not an explicit repository file: ${file}`);
    try { if (lstatSync(full).isDirectory()) throw new CliError(`List individual files: ${file}`); }
    catch (e) {
      if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e;
      if (!tracked.has(name) && !deleted.has(name)) throw new CliError(`Not a tracked deleted file: ${file}`);
      if (deleted.has(name)) alreadyDeleted.add(name);
    }
    return name;
  });
  let message = await nonemptyFile(values["message-file"], "--message-file");
  if (!/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build)\([^\n()]+\)!?: .+/.test(message)) throw new CliError("Use a Conventional Commit message with a scope");
  if (Boolean(values.model) !== Boolean(values.email)) throw new CliError("Pass --model and --email together");
  if (values.model && values.email) {
    if (/[\r\n<>]/.test(values.model) || !/^[^\s<>]+@[^\s<>]+$/.test(values.email)) throw new CliError("Invalid co-author");
    const trailer = `Co-Authored-By: ${values.model} <${values.email}>`;
    if (!message.split("\n").includes(trailer)) message = `${message.trimEnd()}\n\n${trailer}\n`;
  }
  const staged = checked(["git", "diff", "--cached", "--name-only", "--no-renames", "-z"], root).split("\0").filter(Boolean);
  if (staged.some((name) => !names.includes(name))) throw new CliError("Unrelated staged paths exist; review the index before committing");
  const toStage = names.filter((name) => !alreadyDeleted.has(name));
  if (toStage.length) checked(["git", "--literal-pathspecs", "add", "--", ...toStage], root);
  const after = checked(["git", "diff", "--cached", "--name-only", "--no-renames", "-z"], root).split("\0").filter(Boolean);
  if (after.some((name) => !names.includes(name))) throw new CliError("Index contains paths outside the requested files; no commit was created");
  if (!checked(["git", "diff", "--cached", "--name-only"], root)) throw new CliError("No staged changes");
  const dir = mkdtempSync(`${tmpdir()}/agent-pr-message-`);
  try {
    const file = `${dir}/message.txt`;
    writeFileSync(file, message, { mode: 0o600 });
    checked(["git", "commit", "-F", file], root);
    console.log(checked(["git", "rev-parse", "HEAD"], root));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function publish(argv: string[]) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    title: { type: "string" }, "body-file": { type: "string" }, base: { type: "string" }, repo: { type: "string" },
  } });
  if (!values.title?.trim()) throw new CliError("--title is required");
  if (values.base?.startsWith("-")) throw new CliError("Invalid base branch");
  await nonemptyFile(values["body-file"], "--body-file");
  const name = writableBranch();
  const origin = parseRemote(checked(["git", "config", "--get", "remote.origin.url"]));
  const pushUrls = checked(["git", "remote", "get-url", "--push", "--all", "origin"]).split("\n");
  if (pushUrls.length !== 1 || parseRemote(pushUrls[0]).id.toLowerCase() !== origin.id.toLowerCase()) {
    throw new CliError("The effective origin push URL must identify the same single GitHub repository as origin");
  }
  const repo = values.repo ? parseRemote(`https://${values.repo.split("/").length === 2 ? `${origin.host}/` : ""}${values.repo}`) : origin;
  if (repo.host !== origin.host) throw new CliError("The base repository and origin must use the same GitHub host");
  const repoFlag = ["--repo", repo.id];
  const candidates = JSON.parse(checked(["gh", "pr", "list", ...repoFlag, "--head", name, "--state", "open", "--json", "url,headRepository,headRepositoryOwner,headRefName", "--limit", "100"]));
  if (!Array.isArray(candidates) || candidates.length >= 100) throw new CliError("Cannot uniquely identify the branch's open PR", 1);
  const open = candidates.filter((pr) => {
    if (typeof pr?.url !== "string" || typeof pr.headRepositoryOwner?.login !== "string" || typeof pr.headRepository?.name !== "string" || typeof pr.headRefName !== "string") throw new CliError("Incomplete PR head metadata", 1);
    const url = new URL(pr.url);
    if (url.host !== repo.host || !url.pathname.startsWith(`/${repo.owner}/${repo.name}/pull/`)) throw new CliError("PR response belongs to a different repository", 1);
    return pr.headRepositoryOwner.login.toLowerCase() === origin.owner.toLowerCase() && pr.headRepository.name.toLowerCase() === origin.name.toLowerCase() && pr.headRefName === name;
  });
  if (open.length > 1) throw new CliError("Multiple open PRs match this checkout", 1);
  checked(["git", "push", "--set-upstream", "origin", name]);
  const base = values.base ? ["--base", values.base] : [];
  const common = [...repoFlag, "--title", values.title, "--body-file", resolve(values["body-file"]!), ...base];
  if (open.length) {
    checked(["gh", "pr", "edit", open[0].url, ...common]);
    console.log(open[0].url);
  } else {
    const head = repo.id.toLowerCase() === origin.id.toLowerCase() ? name : `${origin.owner}:${name}`;
    console.log(checked(["gh", "pr", "create", "--draft", "--head", head, ...common]));
  }
}

function parseRemote(remote: string) {
  const ssh = remote.match(/^git@([^:]+):(.+)$/);
  let url: URL;
  try { url = new URL(ssh ? `https://${ssh[1]}/${ssh[2]}` : remote); }
  catch { throw new CliError("origin must be a GitHub HTTPS or SSH repository URL"); }
  const parts = url.pathname.replace(/^\//, "").replace(/\/?$/, "").replace(/\.git$/, "").split("/");
  if (!["https:", "ssh:"].includes(url.protocol) || parts.length !== 2 || parts.some((p) => !/^[\w.-]+$/.test(p))) throw new CliError("Invalid GitHub repository URL");
  return { host: url.hostname, owner: parts[0], name: parts[1], id: `${url.hostname}/${parts.join("/")}` };
}

export async function runCli(argv: string[]): Promise<number> {
  const optionArgs = argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv;
  if (!argv.length || optionArgs.includes("--help") || optionArgs.includes("-h")) { console.log(HELP); return 0; }
  try {
    const [name, ...rest] = argv;
    if (name === "context") await context(rest);
    else if (name === "commit") await commit(rest);
    else if (name === "publish") await publish(rest);
    else throw new CliError(`Unknown command: ${name}`);
    return 0;
  } catch (error) {
    if (error instanceof TypeError && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS")) return fail(new CliError(error.message));
    return fail(error);
  }
}
