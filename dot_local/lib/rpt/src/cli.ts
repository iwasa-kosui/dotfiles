import { parseArgs, usage } from "./args.ts";
import type { Failure } from "./result.ts";

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
    case "build":
      writeFailure({
        kind: "build",
        exitCode: 4,
        message: "report build is not implemented",
      });
      return 4;
  }
}

function writeFailure(error: Failure): void {
  console.error(`rpt: ${error.message}`);
  if (error.hint !== undefined) {
    console.error(`hint: ${error.hint}`);
  }
}
