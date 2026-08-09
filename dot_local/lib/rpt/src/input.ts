import { readFile, stat } from "node:fs/promises";
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
  if (input === "-") {
    const source = await readStandardInput();
    if (!source.ok) {
      return source;
    }
    return {
      ok: true,
      value: { source: source.value, baseDirectory: resolve(cwd) },
    };
  }

  const inputPath = resolve(cwd, input);
  try {
    const inputStat = await stat(inputPath);
    if (inputStat.size > maximumInputBytes) {
      return inputTooLarge();
    }
    const source = await readFile(inputPath, "utf8");
    return {
      ok: true,
      value: { source, baseDirectory: dirname(inputPath) },
    };
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
}

async function readStandardInput(): Promise<Result<string>> {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumInputBytes) {
        try {
          await reader.cancel();
        } catch {
          // The input error remains authoritative when the producer has closed.
        }
        return inputTooLarge();
      }
      chunks.push(chunk.value);
    }
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "io",
        exitCode: 5,
        message: "could not read input: -",
        location: { line: 1, column: 1 },
        cause,
      },
    };
  } finally {
    reader.releaseLock();
  }

  const source = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    source.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(source) };
}

function inputTooLarge(): Result<never> {
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
