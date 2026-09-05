import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { CliError, command, fail, nonemptyFile } from "./process.ts";

const HELP = `Usage: handoff write --brief <json-file> [--out-dir <directory>]

Write a handoff document and print JSON containing its absolute path.
Default: ~/.claude/handoffs/<repo>/<branch>/<timestamp>.md
The existing session hook discovers this location. Existing files are never replaced.

Brief JSON:
  {"title":"Task title","goal":"Original request",
   "facts":["Verified fact with a source"],"decisions":["Decision and reason"],
   "pending":["Next action"],"resume":"How to continue"}
title and goal are required strings. facts, decisions, pending are optional string arrays.
resume is an optional string. Omitted sections are left out.
Git status, branch, checkout, stash and available base diff metadata are added automatically.
Exit codes: 0 success, 1 filesystem/process failure, 2 invalid input.
`;

type Brief = { title: string; goal: string; facts?: string[]; decisions?: string[]; pending?: string[]; resume?: string };
function parseBrief(value: unknown): Brief {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("Brief must be a JSON object");
  const v = value as Record<string, unknown>;
  const keys = ["title", "goal", "facts", "decisions", "pending", "resume"];
  if (Object.keys(v).some((key) => !keys.includes(key))) throw new CliError("Unknown brief field; see handoff --help");
  for (const key of ["title", "goal"]) if (typeof v[key] !== "string" || !v[key].trim()) throw new CliError(`${key} must be a nonempty string`);
  if (/[\r\n]/.test(v.title as string)) throw new CliError("title must be one line");
  for (const key of ["facts", "decisions", "pending"]) {
    if (v[key] !== undefined && (!Array.isArray(v[key]) || v[key].some((x: unknown) => typeof x !== "string" || !x.trim()))) throw new CliError(`${key} must be an array of nonempty strings`);
  }
  if (v.resume !== undefined && typeof v.resume !== "string") throw new CliError("resume must be a string");
  return v as Brief;
}

export async function runCli(argv: string[]): Promise<number> {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) { console.log(HELP); return 0; }
  try {
    if (argv[0] !== "write") throw new CliError(`Unknown command: ${argv[0]}`);
    const { values } = parseArgs({ args: argv.slice(1), strict: true, options: { brief: { type: "string" }, "out-dir": { type: "string" } } });
    let raw: unknown;
    try { raw = JSON.parse(await nonemptyFile(values.brief, "--brief")); }
    catch (error) { if (error instanceof SyntaxError) throw new CliError(`Invalid brief JSON: ${error.message}`); throw error; }
    const brief = parseBrief(raw);
    const checkout = command(["git", "rev-parse", "--show-toplevel"]);
    const inRepo = checkout.code === 0;
    const common = inRepo ? command(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]).out : "";
    const repo = common ? basename(dirname(common)) : "_no-repo";
    const branch = inRepo ? command(["git", "symbolic-ref", "--short", "HEAD"]).out || command(["git", "rev-parse", "--short", "HEAD"]).out : "_";
    const slug = branch.replaceAll("/", "-");
    const output = values["out-dir"] ? resolve(values["out-dir"]) : join(homedir(), ".claude", "handoffs", repo, slug);
    const now = new Date();
    const metadata = [`- リポジトリ: ${repo}`, `- ブランチ: ${branch}`, `- worktree: ${inRepo ? checkout.out : process.cwd()}`, `- 作成: ${now.toISOString()}`];
    const sections = [`# ${brief.title}`, metadata.join("\n"), `## ゴール\n\n${brief.goal}`];
    for (const [key, heading] of [["facts", "確定した事実"], ["decisions", "決定と却下案"], ["pending", "未完了の作業"]] as const) {
      if (brief[key]?.length) sections.push(`## ${heading}\n\n${brief[key].map((line) => `- ${line}`).join("\n")}`);
    }
    let status = "";
    if (inRepo) {
      status = command(["git", "status", "--short"]).out;
      if (status) sections.push(`## 未コミットの変更\n\n\`\`\`text\n${status}\n\`\`\``);
      const stash = command(["git", "stash", "list"]).out;
      if (stash) sections.push(`## Stash\n\n\`\`\`text\n${stash}\n\`\`\``);
      const base = command(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).out || "origin/main";
      const diff = command(["git", "diff", "--stat", `${base}...HEAD`, "--"]);
      if (diff.code === 0 && diff.out) sections.push(`## コミット済みの変更\n\n\`\`\`text\n${diff.out}\n\`\`\``);
    }
    sections.push(`## 再開手順\n\n${brief.resume ?? `作業ディレクトリ: ${inRepo ? checkout.out : process.cwd()}`}`);
    mkdirSync(output, { recursive: true });
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    for (let n = 1; ; n++) {
      const path = join(output, `${timestamp}${n === 1 ? "" : `-${n}`}.md`);
      try {
        writeFileSync(path, `${sections.join("\n\n")}\n`, { flag: "wx", mode: 0o600 });
        console.log(JSON.stringify({ path, uncommittedChanges: Boolean(status) }));
        return 0;
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS")) return fail(new CliError(String(error)));
    return fail(error);
  }
}
