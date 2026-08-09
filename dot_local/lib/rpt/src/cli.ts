import { resolve } from "node:path";
import { parseArgs, usage } from "./args.ts";
import { buildReport } from "./build.ts";
import { inlineAssets } from "./inline-assets.ts";
import { readInput } from "./input.ts";
import { checkOutput, writeOutput } from "./output.ts";
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
      const outputPath = resolve(process.cwd(), command.value.output);
      const outputCheck = await checkOutput(outputPath, command.value.force);
      if (!outputCheck.ok) {
        writeFailure(outputCheck.error, command.value.debug);
        return outputCheck.error.exitCode;
      }
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
      const build = await buildReport(report.value, resolve(import.meta.dir, ".."));
      if (!build.ok) {
        writeFailure(build.error, command.value.debug);
        return build.error.exitCode;
      }

      try {
        const inlined = await inlineAssets(
          build.value.html,
          build.value.distDirectory,
        );
        if (!inlined.ok) {
          writeFailure(inlined.error, command.value.debug);
          return inlined.error.exitCode;
        }
        const output = await writeOutput(
          inlined.value,
          outputCheck.value,
          command.value.force,
        );
        if (!output.ok) {
          writeFailure(output.error, command.value.debug);
          return output.error.exitCode;
        }
        console.log(output.value);
        return 0;
      } finally {
        try {
          await build.value.cleanup();
        } catch {
          // A cleanup failure must not replace the result of the output write.
        }
      }
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
