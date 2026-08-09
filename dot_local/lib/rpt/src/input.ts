import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Result } from "./result.ts";

const maximumInputBytes = 5 * 1024 * 1024;

export type ReportInput = Readonly<{
  source: string;
  baseDirectory: string;
}>;

export async function readInput(
  input: string,
  cwd: string,
): Promise<Result<ReportInput>> {
  let source: string;
  let baseDirectory: string;

  try {
    if (input === "-") {
      source = await Bun.stdin.text();
      baseDirectory = resolve(cwd);
    } else {
      const inputPath = resolve(cwd, input);
      source = await readFile(inputPath, "utf8");
      baseDirectory = dirname(inputPath);
    }
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "io",
        exitCode: 5,
        message: "could not read input: " + input,
        location: { line: 1, column: 1 },
        cause,
      },
    };
  }

  if (Buffer.byteLength(source, "utf8") > maximumInputBytes) {
    return {
      ok: false,
      error: {
        kind: "input",
        exitCode: 3,
        message: "input exceeds the 5 MiB limit",
        location: { line: 1, column: 1 },
      },
    };
  }

  return { ok: true, value: { source, baseDirectory } };
}
