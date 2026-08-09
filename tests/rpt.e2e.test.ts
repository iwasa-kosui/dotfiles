import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

async function runRptWithOpenStdin(
  args: readonly string[],
  stdin: string,
) {
  const process = Bun.spawn(["bun", cliPath, ...args], {
    cwd: repositoryRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stdin.write(stdin);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    process.exited.then((exitCode) => ({ timedOut: false, exitCode })),
    new Promise<Readonly<{ timedOut: true }>>((resolve) => {
      timeoutId = setTimeout(() => resolve({ timedOut: true }), 2_000);
    }),
  ]);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  if (outcome.timedOut) {
    process.kill();
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { timedOut: outcome.timedOut, exitCode, stdout, stderr };
}

async function createCase(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "rpt-e2e-"));
  const input = join(directory, "report.mdx");
  const output = join(directory, "report.html");
  await writeFile(input, source);

  return {
    input,
    output,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
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

const rejectedMdx = [
  [
    "a missing frontmatter title",
    "---\nsummary: x\n---\n# Report",
    "frontmatter.title is required",
  ],
  [
    "an unknown frontmatter key",
    "---\ntitle: X\nunknown: x\n---",
    "frontmatter.unknown is not allowed",
  ],
  [
    "an invalid createdAt date",
    "---\ntitle: X\ncreatedAt: 2026-02-30\n---",
    "frontmatter.createdAt must be a YYYY-MM-DD date",
  ],
  [
    "an invalid status",
    "---\ntitle: X\nstatus: published\n---",
    "frontmatter.status must be draft, final, or archived",
  ],
  [
    "invalid tags",
    "---\ntitle: X\ntags: [valid, \"\"]\n---",
    "frontmatter.tags must be an array of non-empty strings",
  ],
  [
    "an import",
    "---\ntitle: X\n---\nimport x from 'node:fs'",
    "import and export are not allowed",
  ],
  [
    "a JavaScript expression",
    "---\ntitle: X\n---\n{process.cwd()}",
    "JavaScript expressions are not allowed",
  ],
  [
    "raw HTML",
    "---\ntitle: X\n---\n<script>alert(1)</script>",
    "raw HTML is not allowed",
  ],
  [
    "an unknown component",
    "---\ntitle: X\n---\n<Button>run</Button>",
    "component Button is not allowed",
  ],
  [
    "a dynamic component attribute",
    "---\ntitle: X\n---\n<Callout tone={level}>run</Callout>",
    "dynamic component attributes are not allowed",
  ],
  [
    "a style component attribute",
    "---\ntitle: X\n---\n<Callout tone=\"info\" style=\"color: red\">run</Callout>",
    "attribute style is not allowed on Callout",
  ],
  [
    "an event component attribute",
    "---\ntitle: X\n---\n<Callout tone=\"info\" onClick=\"run\">run</Callout>",
    "attribute onClick is not allowed on Callout",
  ],
  [
    "a non-HTTPS Evidence source",
    "---\ntitle: X\n---\n<Evidence title=\"source\" source=\"http://example.com\">run</Evidence>",
    "Evidence.source must use https",
  ],
  [
    "a remote image",
    "---\ntitle: X\n---\n![remote](https://example.com/pixel.png)",
    "remote images are not allowed",
  ],
  [
    "a remote image reference",
    "---\ntitle: X\n---\n![remote][pixel]\n\n[pixel]: https://example.com/pixel.png",
    "remote images are not allowed",
  ],
  [
    "an image outside the input directory",
    "---\ntitle: X\n---\n![outside](../pixel.png)",
    "image paths must stay within the input directory",
  ],
  [
    "a Metric with children",
    "---\ntitle: X\n---\n<Metric label=\"L\" value=\"V\">child</Metric>",
    "Metric must not have children",
  ],
  [
    "a nested Section",
    "---\ntitle: X\n---\n<Section title=\"Outer\">\n<Section title=\"Inner\">x</Section>\n</Section>",
    "Section must not be nested",
  ],
  [
    "a user-provided Section anchor",
    "---\ntitle: X\n---\n<Section title=\"X\" anchor=\"user-value\">\nx\n</Section>",
    "attribute anchor is not allowed on Section",
  ],
] as const;

for (const [name, source, message] of rejectedMdx) {
  test("build rejects " + name + " before creating an output file", async () => {
    const testCase = await createCase(source);
    try {
      const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

      expect(result.exitCode).toBe(3);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^rpt: \d+:\d+:/);
      expect(result.stderr).toContain(message);
      expect(await Bun.file(testCase.output).exists()).toBe(false);
    } finally {
      await testCase.cleanup();
    }
  });
}

test("build rejects input that exceeds 5 MiB before creating an output file", async () => {
  const source = "---\ntitle: X\n---\n" + "a".repeat(5 * 1024 * 1024);
  const testCase = await createCase(source);
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^rpt: \d+:\d+:/);
    expect(result.stderr).toContain("input exceeds the 5 MiB limit");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

test("build stops an oversized stdin stream before its input closes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpt-e2e-"));
  const output = join(directory, "report.html");
  const source = "---\ntitle: X\n---\n" + "a".repeat(5 * 1024 * 1024);
  try {
    const result = await runRptWithOpenStdin(["build", "-", "-o", output], source);

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("input exceeds the 5 MiB limit");
    expect(await Bun.file(output).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("build rejects a self-closing Section before creating an output file", async () => {
  const testCase = await createCase(
    "---\ntitle: X\n---\n\n<Section title=\"Empty\" />",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("Section must not be self-closing");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

test("build rejects a Section that shares a paragraph with another component", async () => {
  const testCase = await createCase(
    "---\ntitle: X\n---\n\n<Callout tone=\"info\">context</Callout><Section title=\"Nested\">body</Section>",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("Section must be at the document top level");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

test("build advances validated restricted MDX to the build stage", async () => {
  const testCase = await createCase(
    "---\ntitle: Valid report\n---\n\n## Finding\n\n<Section title=\"Next steps\">\nContinue.\n</Section>",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rpt: report build is not implemented\n");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

test("build accepts the allowed component set before the build stage", async () => {
  const testCase = await createCase(
    "---\ntitle: 開発環境の移行調査\nsummary: 段階的な移行を推奨します。\nauthor: Platform Team\ncreatedAt: 2026-08-09\nstatus: final\ntags: [migration, tooling]\n---\n\n## 結論\n\n<Callout tone=\"success\" title=\"推奨案\">段階的に移行します。</Callout>\n\n<Metric label=\"削減工数\" value=\"24%\" />\n\n<Evidence title=\"試行結果\" source=\"https://example.com/evidence\">重大な障害はありませんでした。</Evidence>\n\n<Section title=\"次の対応\">\n2週間の試行を開始します。\n</Section>",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rpt: report build is not implemented\n");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});
