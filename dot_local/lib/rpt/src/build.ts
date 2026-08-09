import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Result } from "./result.ts";
import type { ValidatedReport } from "./validate.ts";

export type BuiltReport = Readonly<{
  html: string;
  distDirectory: string;
  cleanup: () => Promise<void>;
}>;

export async function buildReport(
  report: ValidatedReport,
  packageRoot: string,
): Promise<Result<BuiltReport>> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rpt-build-"));
  const cleanup = createCleanup(temporaryRoot);

  try {
    await cp(join(packageRoot, "template"), temporaryRoot, { recursive: true });
    await Promise.all([
      writeFile(join(temporaryRoot, "src/content/report.mdx"), report.source),
      writeFile(
        join(temporaryRoot, "src/content/report-data.json"),
        JSON.stringify({ metadata: report.metadata, outline: report.outline }),
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
      await cleanup();
      return buildFailure("could not build report", new Error(stdout + stderr));
    }

    const distDirectory = join(temporaryRoot, "dist");
    const indexPath = join(distDirectory, "index.html");
    let htmlFiles: string[];
    try {
      htmlFiles = await findHtmlFiles(distDirectory);
    } catch (cause) {
      await cleanup();
      return buildFailure(
        "report build must produce only dist/index.html",
        new Error(stdout + stderr + "\n" + String(cause)),
      );
    }
    if (!htmlFiles.includes(indexPath) || htmlFiles.length !== 1) {
      await cleanup();
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
        cleanup,
      },
    };
  } catch (cause) {
    await cleanup();
    return buildFailure("could not build report", cause);
  }
}

function createCleanup(directory: string): () => Promise<void> {
  let cleaned = false;
  return async () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    await rm(directory, { recursive: true, force: true });
  };
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
