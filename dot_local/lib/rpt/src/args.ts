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

export const usage = `Usage: rpt build <input.mdx|-> -o <output.html>

Options:
  -o, --output <path>  Write the report to this HTML file
      --force          Replace an existing output file
      --debug          Show stack traces for internal errors
  -h, --help           Show this help message
  -v, --version        Show the rpt version
`;

export function parseArgs(argv: readonly string[]): Result<Command> {
  if (argv.length === 1 && isHelp(argv[0])) {
    return { ok: true, value: { kind: "help" } };
  }
  if (argv.length === 1 && isVersion(argv[0])) {
    return { ok: true, value: { kind: "version" } };
  }
  if (argv[0] !== "build") {
    return failure(argv.length === 0 ? "a command is required" : `unknown command: ${argv[0]}`);
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
    if (argument.startsWith("-")) {
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
