import { expect, test } from "bun:test";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const cliPath = join(repositoryRoot, "dot_local/bin/executable_rpt");

async function runRpt(
  args: readonly string[],
  options: { cwd?: string; stdin?: string } = {},
) {
  const process = Bun.spawn(["bun", cliPath, ...args], {
    cwd: options.cwd ?? repositoryRoot,
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined) {
    process.stdin.write(options.stdin);
    process.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("--help displays the rpt build usage", async () => {
  const result = await runRpt(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: rpt build <input.mdx|-> -o <output.html>");
  expect(result.stderr).toBe("");
});

test("--version displays the current CLI version", async () => {
  const result = await runRpt(["--version"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("0.1.0\n");
  expect(result.stderr).toBe("");
});

test("build without an output path reports a usage error", async () => {
  const result = await runRpt(["build", "report.mdx"]);

  expect(result.exitCode).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("rpt: --output is required\n");
});
