import { failure, type Result } from "./result.ts";

export type Command =
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "version" }>
  | Readonly<{
      kind: "build";
      input: string;
      output: string;
      force: boolean;
      debug: boolean;
    }>;

export const usage = `rpt — AI-native HTML report builder

Turn AI-authored, restricted MDX into a self-contained HTML report.

Usage: rpt build <input.mdx|-> -o <output.html>

Quick start:
  rpt build report.mdx -o report.html
  cat report.mdx | rpt build - -o report.html

AI authoring contract:
  Required frontmatter:
    title: required non-empty string

  Optional frontmatter:
    summary: string
    author: string
    createdAt: YYYY-MM-DD
    status: draft | final | archived
    tags: array of non-empty strings

  Body:
    Markdown and GFM (tables, task lists, footnotes, and code blocks)

  Allowed components:
    Callout, Metric, Evidence, Section
    <Callout tone="info|success|warning|danger" title="Optional">...</Callout>
    <Metric label="Label" value="Value" />
    <Evidence title="Source" source="https://example.com">...</Evidence>
    <Section title="Section title">...</Section>

  Restrictions:
    Do not use imports, exports, JavaScript expressions, raw HTML, or other components.
    Images must be relative local raster files or valid raster data URLs.
    Input and each image are limited to 5 MiB; all decoded images total 20 MiB.

Options:
  -o, --output <path>  Write the report to this HTML file
      --force          Replace an existing output file
      --debug          Show stack traces for internal errors
  -h, --help           Show this help message
  -v, --version        Show the rpt version

Output:
  On success, rpt writes the absolute output path to stdout.
  Diagnostics are written to stderr. Existing files require --force.
`;

export function parseArgs(argv: readonly string[]): Result<Command> {
  if (argv.length === 0 || (argv.length === 1 && isHelp(argv[0]))) {
    return { ok: true, value: { kind: "help" } };
  }
  if (argv.length === 1 && isVersion(argv[0])) {
    return { ok: true, value: { kind: "version" } };
  }
  if (argv[0] !== "build") {
    return failure(`unknown command: ${argv[0]}`);
  }

  let input: string | undefined;
  let output: string | undefined;
  let force = false;
  let debug = false;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (isHelp(argument)) {
      return { ok: true, value: { kind: "help" } };
    }
    if (isVersion(argument)) {
      return { ok: true, value: { kind: "version" } };
    }
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--debug") {
      debug = true;
      continue;
    }
    if (argument === "-o" || argument === "--output") {
      const outputArgument = argv[index + 1];
      if (outputArgument === undefined || outputArgument.startsWith("-")) {
        return failure(`${argument} requires a path`);
      }
      if (output !== undefined) {
        return failure("--output may only be specified once");
      }
      output = outputArgument;
      index += 1;
      continue;
    }
    if (argument.startsWith("-") && argument !== "-") {
      return failure(`unknown option: ${argument}`);
    }
    if (input !== undefined) {
      return failure(`unexpected argument: ${argument}`);
    }
    input = argument;
  }

  if (input === undefined) {
    return failure("an input file is required");
  }
  if (output === undefined) {
    return failure("--output is required");
  }
  return { ok: true, value: { kind: "build", input, output, force, debug } };
}

function isHelp(argument: string | undefined): boolean {
  return argument === "-h" || argument === "--help";
}

function isVersion(argument: string | undefined): boolean {
  return argument === "-v" || argument === "--version";
}
