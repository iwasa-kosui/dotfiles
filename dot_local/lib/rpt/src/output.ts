import { randomUUID } from "node:crypto";
import { link, lstat, open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Result } from "./result.ts";

export async function checkOutput(
  output: string,
  force: boolean,
): Promise<Result<string>> {
  const outputPath = resolve(output);
  try {
    if (!force && (await pathExists(outputPath))) {
      return ioFailure("output already exists: " + output);
    }
    return { ok: true, value: outputPath };
  } catch (cause) {
    return ioFailure("could not inspect output: " + output, cause);
  }
}

export async function writeOutput(
  html: string,
  output: string,
  force: boolean,
): Promise<Result<string>> {
  const outputPath = resolve(output);
  const outputDirectory = dirname(outputPath);
  try {
    const directoryStat = await stat(outputDirectory);
    if (!directoryStat.isDirectory()) {
      return ioFailure(
        "output directory is not a directory: " + outputDirectory,
      );
    }
  } catch (cause) {
    return ioFailure("output directory does not exist: " + outputDirectory, cause);
  }
  if (!force && (await pathExists(outputPath))) {
    return ioFailure("output already exists: " + output);
  }

  let temporaryPath: string | undefined;
  try {
    const temporary = await createTemporaryOutput(outputPath);
    temporaryPath = temporary.path;
    try {
      await temporary.handle.writeFile(html, "utf8");
    } finally {
      await temporary.handle.close();
    }

    if (force) {
      await rename(temporaryPath, outputPath);
      temporaryPath = undefined;
    } else {
      try {
        await link(temporaryPath, outputPath);
      } catch (cause) {
        if (isErrorCode(cause, "EEXIST")) {
          return ioFailure("output already exists: " + output, cause);
        }
        throw cause;
      }
      await unlink(temporaryPath);
      temporaryPath = undefined;
    }
    return { ok: true, value: outputPath };
  } catch (cause) {
    return ioFailure("could not write output: " + output, cause);
  } finally {
    if (temporaryPath !== undefined) {
      try {
        await unlink(temporaryPath);
      } catch {
        // The output failure remains authoritative when temporary cleanup fails.
      }
    }
  }
}

async function createTemporaryOutput(outputPath: string) {
  const directory = dirname(outputPath);
  const name = basename(outputPath);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const path = resolve(directory, `.${name}.rpt-${randomUUID()}.tmp`);
    try {
      return { path, handle: await open(path, "wx") };
    } catch (cause) {
      if (!isErrorCode(cause, "EEXIST")) {
        throw cause;
      }
    }
  }
  throw new Error("could not allocate an exclusive temporary output file");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (isErrorCode(cause, "ENOENT")) {
      return false;
    }
    throw cause;
  }
}

function isErrorCode(cause: unknown, code: string): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === code
  );
}

function ioFailure(message: string, cause?: unknown): Result<never> {
  return {
    ok: false,
    error: {
      kind: "io",
      exitCode: 5,
      message,
      ...(cause === undefined ? {} : { cause }),
    },
  };
}
