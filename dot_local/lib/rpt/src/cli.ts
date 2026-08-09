import { parseArgs, usage } from "./args.ts";
import { readInput } from "./input.ts";
import type { Failure } from "./result.ts";
import { validateReport } from "./validate.ts";

const version = "0.1.0";

export async function runCli(argv: readonly string[]): Promise<number> {
  const command = parseArgs(argv);
  if (!command.ok) {
    writeFailure(command.error);
    return command.error.exitCode;
  }

  switch (command.value.kind) {
    case "help":
      console.log(usage.trimEnd());
      return 0;
    case "version":
      console.log(version);
      return 0;
    case "build": {
      const input = await readInput(command.value.input, process.cwd());
      if (!input.ok) {
        writeFailure(input.error, command.value.debug);
        return input.error.exitCode;
      }
      const report = validateReport(input.value);
      if (!report.ok) {
        writeFailure(report.error, command.value.debug);
        return report.error.exitCode;
      }
      writeFailure({
        kind: "build",
        exitCode: 4,
        message: "report build is not implemented",
      });
      return 4;
    }
  }
}

function writeFailure(error: Failure, debug = false): void {
  const location =
    error.location === undefined
      ? ""
      : error.location.line + ":" + error.location.column + ": ";
  console.error("rpt: " + location + error.message);
  if (error.hint !== undefined) {
    console.error("hint: " + error.hint);
  }
  if (debug && error.cause instanceof Error) {
    console.error(error.cause.stack ?? error.cause.message);
  }
}
