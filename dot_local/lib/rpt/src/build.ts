import {
  constants,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { readBounded } from "./bounded-read.ts";
import { detectImageMimeType } from "./image.ts";
import {
  createFinalDomPolicy,
  type FinalDomPolicy,
} from "./final-dom-policy.ts";
import {
  maximumImageBytes,
  maximumTotalImageBytes,
} from "./limits.ts";
import type { Result } from "./result.ts";
import type { ValidatedReport } from "./validate.ts";

export type BuiltReport = Readonly<{
  html: string;
  distDirectory: string;
  finalDomPolicy: FinalDomPolicy;
  cleanup: () => Promise<void>;
}>;

export async function buildReport(
  report: ValidatedReport,
  packageRoot: string,
): Promise<Result<BuiltReport>> {
  let temporaryRoot: string;
  try {
    temporaryRoot = await mkdtemp(join(tmpdir(), "rpt-build-"));
  } catch (cause) {
    return buildFailure("could not create temporary build directory", cause);
  }
  const cleanup = createCleanup(temporaryRoot);

  try {
    const finalDomPolicy = report.hasMermaid
      ? createFinalDomPolicy(
          true,
          randomBytes(18).toString("base64url"),
        )
      : createFinalDomPolicy(false);
    await cp(join(packageRoot, "template"), temporaryRoot, { recursive: true });
    const assets = await copyAssets(report, temporaryRoot);
    if (!assets.ok) {
      await cleanupAfterFailure(cleanup);
      return assets;
    }
    await Promise.all([
      writeFile(join(temporaryRoot, "src/content/report.mdx"), report.source),
      writeFile(
        join(temporaryRoot, "src/content/report-data.json"),
        JSON.stringify({
          metadata: report.metadata,
          outline: report.outline,
          mainContentId: report.mainContentId,
          hasMermaid: report.hasMermaid,
          finalDomPolicy,
        }),
      ),
      symlink(
        join(packageRoot, "node_modules"),
        join(temporaryRoot, "node_modules"),
        "dir",
      ),
    ]);

    const process = Bun.spawn(
      ["bun", "run", "--cwd", temporaryRoot, "astro", "build"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (exitCode !== 0) {
      await cleanupAfterFailure(cleanup);
      return buildFailure("could not build report", new Error(stdout + stderr));
    }

    const distDirectory = join(temporaryRoot, "dist");
    const indexPath = join(distDirectory, "index.html");
    let htmlFiles: string[];
    try {
      htmlFiles = await findHtmlFiles(distDirectory);
    } catch (cause) {
      await cleanupAfterFailure(cleanup);
      return buildFailure(
        "report build must produce only dist/index.html",
        new Error(stdout + stderr + "\n" + String(cause)),
      );
    }
    if (!htmlFiles.includes(indexPath) || htmlFiles.length !== 1) {
      await cleanupAfterFailure(cleanup);
      return buildFailure(
        "report build must produce only dist/index.html",
        new Error(stdout + stderr),
      );
    }

    return {
      ok: true,
      value: {
        html: await readFile(indexPath, "utf8"),
        distDirectory,
        finalDomPolicy,
        cleanup,
      },
    };
  } catch (cause) {
    await cleanupAfterFailure(cleanup);
    return buildFailure("could not build report", cause);
  }
}

async function copyAssets(
  report: ValidatedReport,
  temporaryRoot: string,
): Promise<Result<void>> {
  let realBaseDirectory: string;
  try {
    realBaseDirectory = await realpath(report.baseDirectory);
  } catch (cause) {
    return inputFailure("could not resolve the input directory", cause);
  }
  const contentDirectory = join(temporaryRoot, "src/content");
  let totalImageBytes = report.decodedDataImageBytes;

  for (const asset of report.assets) {
    const destination = resolve(contentDirectory, asset.relativePath);
    if (!isContained(contentDirectory, destination)) {
      return inputFailure("image paths must stay within the input directory");
    }
    try {
      if (await pathExists(destination)) {
        return inputFailure("image path conflicts with generated report content");
      }
      await mkdir(dirname(destination), { recursive: true });

      const realSourcePath = await realpath(asset.sourcePath);
      if (!isContained(realBaseDirectory, realSourcePath)) {
        return inputFailure("image paths must stay within the input directory");
      }
      const handle = await open(
        realSourcePath,
        constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
      );
      let bytes: Uint8Array;
      try {
        const descriptorStat = await handle.stat({ bigint: true });
        const verifiedRealSourcePath = await realpath(realSourcePath);
        if (!isContained(realBaseDirectory, verifiedRealSourcePath)) {
          return inputFailure(
            "image paths must stay within the input directory",
          );
        }
        const pathStat = await stat(verifiedRealSourcePath, { bigint: true });
        if (
          !descriptorStat.isFile() ||
          !pathStat.isFile() ||
          descriptorStat.dev !== pathStat.dev ||
          descriptorStat.ino !== pathStat.ino
        ) {
          return inputFailure("image changed while it was being copied");
        }
        if (descriptorStat.size > BigInt(maximumImageBytes)) {
          return inputFailure(
            "image exceeds the 5 MiB limit: " + asset.relativePath,
          );
        }
        bytes = await readBounded(handle, maximumImageBytes);
      } finally {
        await handle.close();
      }
      if (bytes.byteLength > maximumImageBytes) {
        return inputFailure(
          "image exceeds the 5 MiB limit: " + asset.relativePath,
        );
      }
      totalImageBytes += bytes.byteLength;
      if (totalImageBytes > maximumTotalImageBytes) {
        return inputFailure("images exceed the 20 MiB total limit");
      }
      if (detectImageMimeType(bytes) === undefined) {
        return inputFailure(
          "image format is not allowed: " + asset.relativePath,
        );
      }
      await writeFile(destination, bytes, { flag: "wx" });
    } catch (cause) {
      return inputFailure("could not copy image: " + asset.relativePath, cause);
    }
  }
  return { ok: true, value: undefined };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    ) {
      return false;
    }
    throw cause;
  }
}

function isContained(base: string, candidate: string): boolean {
  const path = relative(base, candidate);
  return (
    path === "" ||
    (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path))
  );
}

function createCleanup(directory: string): () => Promise<void> {
  let cleaned = false;
  return async () => {
    if (cleaned) {
      return;
    }
    await rm(directory, { recursive: true, force: true });
    cleaned = true;
  };
}

async function cleanupAfterFailure(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch {
    // The build failure remains authoritative when temporary cleanup also fails.
  }
}

async function findHtmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return findHtmlFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
    }),
  );
  return files.flat();
}

function buildFailure(message: string, cause?: unknown): Result<never> {
  return {
    ok: false,
    error: {
      kind: "build",
      exitCode: 4,
      message,
      ...(cause === undefined ? {} : { cause }),
    },
  };
}

function inputFailure(message: string, cause?: unknown): Result<never> {
  return {
    ok: false,
    error: {
      kind: "input",
      exitCode: 3,
      message,
      location: { line: 1, column: 1 },
      ...(cause === undefined ? {} : { cause }),
    },
  };
}
