import { constants, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readBounded } from "./bounded-read.ts";
import { maximumInputBytes } from "./limits.ts";
import type { Result } from "./result.ts";

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
    const handle = await open(
      inputPath,
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    try {
      const descriptorStat = await handle.stat();
      if (!descriptorStat.isFile()) {
        return inputReadFailure("input must be a regular file: " + input);
      }
      if (descriptorStat.size > maximumInputBytes) {
        return inputTooLarge();
      }
      const bytes = await readBounded(handle, maximumInputBytes);
      if (bytes.byteLength > maximumInputBytes) {
        return inputTooLarge();
      }
      return {
        ok: true,
        value: {
          source: new TextDecoder().decode(bytes),
          baseDirectory: dirname(inputPath),
        },
      };
    } finally {
      await handle.close();
    }
  } catch (cause) {
    return inputReadFailure("could not read input: " + input, cause);
  }
}

function inputReadFailure(message: string, cause?: unknown): Result<never> {
  return {
    ok: false,
    error: {
      kind: "io",
      exitCode: 5,
      message,
      location: { line: 1, column: 1 },
      ...(cause === undefined ? {} : { cause }),
    },
  };
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
