import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inlineAssets } from "../dot_local/lib/rpt/src/inline-assets.ts";
import { writeOutput } from "../dot_local/lib/rpt/src/output.ts";

const repositoryRoot = join(import.meta.dir, "..");
const cliPath = join(repositoryRoot, "dot_local/bin/executable_rpt");

async function runRpt(
  args: readonly string[],
  options: { cwd?: string; stdin?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const process = Bun.spawn(["bun", cliPath, ...args], {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env,
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
    directory,
    input,
    output,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function runInlineFixture(html: string) {
  const directory = await mkdtemp(join(tmpdir(), "rpt-inline-e2e-"));
  try {
    return await inlineAssets(html, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
    "a data URL image whose bytes cannot be independently validated",
    "---\ntitle: X\n---\n![svg](data:image/svg+xml,%3Csvg%3E%3C/svg%3E)",
    "data URL images are not allowed",
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

test("build renders an allowed report as a readable static HTML document", async () => {
  const testCase = await createCase(
    "---\ntitle: 開発環境の移行調査\nsummary: 段階的な移行を推奨します。\nauthor: Platform Team\ncreatedAt: 2026-08-09\nstatus: final\ntags: [migration, tooling]\n---\n\n## 結論\n\n<Callout tone=\"success\" title=\"推奨案\">段階的に移行します。</Callout>\n\n<Metric label=\"削減工数\" value=\"24%\" />\n\n<Evidence title=\"試行結果\" source=\"https://example.com/evidence\">重大な障害はありませんでした。</Evidence>\n\n<Section title=\"次の対応\">\n2週間の試行を開始します。\n</Section>",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${testCase.output}\n`);
    const html = await Bun.file(testCase.output).text();
    expect(html).toContain("<title>開発環境の移行調査</title>");
    expect(html).toContain('data-rpt-component="callout"');
    expect(html).toContain('data-rpt-component="metric"');
    expect(html).toContain('data-rpt-component="evidence"');
    expect(html).toContain('id="section-次の対応"');
    expect(html).toContain('aria-label="目次"');
    expect(html).toContain('class="rpt-skip-link"');
    expect(html).not.toContain("<script");
  } finally {
    await testCase.cleanup();
  }
});

test("build gives every table-of-contents link one existing HTML id", async () => {
  const testCase = await createCase(
    "---\ntitle: Outline ids\n---\n\n# section-結論\n\n# 結論\n\n<Section title=\"結論\">\nSection body.\n</Section>\n\n## 結論\n\nHeading body.",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    const html = await Bun.file(testCase.output).text();
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const target of targets) {
      expect(ids.filter((id) => id === target)).toHaveLength(1);
    }
  } finally {
    await testCase.cleanup();
  }
});

test("build embeds a local PNG and leaves no executable or external asset references", async () => {
  const testCase = await createCase(
    "---\ntitle: Embedded image\n---\n\n![pixel](./pixel.png)\n\n<Evidence title=\"Source\" source=\"https://example.com/evidence\">Evidence body.</Evidence>",
  );
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  await writeFile(join(testCase.directory, "pixel.png"), png);

  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    const html = await Bun.file(testCase.output).text();
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain('href="https://example.com/evidence"');
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b[^>]*\brel=["']stylesheet["']/i);
    expect(html).not.toMatch(
      /<(?:img|source|video|audio|iframe|embed|object)\b[^>]+(?:src|srcset|poster|data)=["'](?!data:)/i,
    );
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/@import\b/i);
    for (const match of html.matchAll(
      /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi,
    )) {
      expect(match[1]?.startsWith("data:")).toBe(true);
    }
  } finally {
    await testCase.cleanup();
  }
});

test("build reads a report from stdin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpt-e2e-"));
  const output = join(directory, "stdin-report.html");
  try {
    const result = await runRpt(["build", "-", "-o", output], {
      cwd: directory,
      stdin: "---\ntitle: Standard input\n---\n\nReport body.",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${output}\n`);
    expect(await Bun.file(output).text()).toContain(
      "<title>Standard input</title>",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("build without --force preserves an existing output file", async () => {
  const testCase = await createCase("---\ntitle: Replacement\n---\n\nNew body.");
  await writeFile(testCase.output, "original output");
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("output already exists");
    expect(await Bun.file(testCase.output).text()).toBe("original output");
  } finally {
    await testCase.cleanup();
  }
});

test("build with --force atomically replaces an existing output file", async () => {
  const testCase = await createCase("---\ntitle: Replacement\n---\n\nNew body.");
  await writeFile(testCase.output, "original output");
  try {
    const result = await runRpt([
      "build",
      testCase.input,
      "-o",
      testCase.output,
      "--force",
    ]);

    expect(result.exitCode).toBe(0);
    const html = await Bun.file(testCase.output).text();
    expect(html).toContain("<title>Replacement</title>");
    expect(html).not.toContain("original output");
  } finally {
    await testCase.cleanup();
  }
});

test("concurrent no-force output publication lets exactly one writer win", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpt-output-e2e-"));
  const output = join(directory, "report.html");
  const firstHtml = "<!doctype html><title>First</title><p>First body</p>";
  const secondHtml = "<!doctype html><title>Second</title><p>Second body</p>";
  try {
    const results = await Promise.all([
      writeOutput(firstHtml, output, false),
      writeOutput(secondHtml, output, false),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failure = results.find((result) => !result.ok);
    expect(failure?.ok).toBe(false);
    if (failure !== undefined && !failure.ok) {
      expect(failure.error.exitCode).toBe(5);
    }
    expect([firstHtml, secondHtml]).toContain(await Bun.file(output).text());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an invalid forced build preserves the complete existing output", async () => {
  const testCase = await createCase("---\nsummary: Missing title\n---");
  await writeFile(testCase.output, "complete original output");
  try {
    const result = await runRpt([
      "build",
      testCase.input,
      "-o",
      testCase.output,
      "--force",
    ]);

    expect(result.exitCode).toBe(3);
    expect(await Bun.file(testCase.output).text()).toBe("complete original output");
  } finally {
    await testCase.cleanup();
  }
});

test("concurrent builds keep their report contents isolated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpt-e2e-"));
  const firstInput = join(directory, "first.mdx");
  const secondInput = join(directory, "second.mdx");
  const firstOutput = join(directory, "first.html");
  const secondOutput = join(directory, "second.html");
  await Promise.all([
    writeFile(
      firstInput,
      "---\ntitle: First concurrent report\n---\n\nFirst body.",
    ),
    writeFile(
      secondInput,
      "---\ntitle: Second concurrent report\n---\n\nSecond body.",
    ),
  ]);
  try {
    const [firstResult, secondResult] = await Promise.all([
      runRpt(["build", firstInput, "-o", firstOutput]),
      runRpt(["build", secondInput, "-o", secondOutput]),
    ]);

    expect(firstResult.exitCode).toBe(0);
    expect(secondResult.exitCode).toBe(0);
    const [firstHtml, secondHtml] = await Promise.all([
      Bun.file(firstOutput).text(),
      Bun.file(secondOutput).text(),
    ]);
    expect(firstHtml).toContain("<title>First concurrent report</title>");
    expect(firstHtml).not.toContain("Second concurrent report");
    expect(secondHtml).toContain("<title>Second concurrent report</title>");
    expect(secondHtml).not.toContain("First concurrent report");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent builds to one output publish one complete report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpt-e2e-"));
  const firstInput = join(directory, "first.mdx");
  const secondInput = join(directory, "second.mdx");
  const output = join(directory, "report.html");
  await Promise.all([
    writeFile(firstInput, "---\ntitle: First winner\n---\n\nFirst body."),
    writeFile(secondInput, "---\ntitle: Second winner\n---\n\nSecond body."),
  ]);
  try {
    const results = await Promise.all([
      runRpt(["build", firstInput, "-o", output]),
      runRpt(["build", secondInput, "-o", output]),
    ]);

    expect(results.map((result) => result.exitCode).sort()).toEqual([0, 5]);
    const html = await Bun.file(output).text();
    const firstWon = html.includes("<title>First winner</title>");
    const secondWon = html.includes("<title>Second winner</title>");
    expect(firstWon === secondWon).toBe(false);
    expect(html.includes("First body.")).toBe(firstWon);
    expect(html.includes("Second body.")).toBe(secondWon);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("build rejects an image whose bytes do not match an allowed format", async () => {
  const testCase = await createCase(
    "---\ntitle: Invalid image\n---\n\n![pixel](./pixel.png)",
  );
  await writeFile(join(testCase.directory, "pixel.png"), "not a PNG");
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("image format is not allowed");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

test("build rejects an image symlink that escapes the input directory", async () => {
  const testCase = await createCase(
    "---\ntitle: Escaping image\n---\n\n![pixel](./pixel.png)",
  );
  const outsideDirectory = await mkdtemp(join(tmpdir(), "rpt-outside-"));
  const outsideImage = join(outsideDirectory, "pixel.png");
  await writeFile(
    outsideImage,
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  await symlink(outsideImage, join(testCase.directory, "pixel.png"));
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain(
      "image paths must stay within the input directory",
    );
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await Promise.all([
      testCase.cleanup(),
      rm(outsideDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("build rejects an image through a parent symlink outside the input directory", async () => {
  const testCase = await createCase(
    "---\ntitle: Escaping image directory\n---\n\n![pixel](./assets/pixel.png)",
  );
  const outsideDirectory = await mkdtemp(join(tmpdir(), "rpt-outside-"));
  await writeFile(
    join(outsideDirectory, "pixel.png"),
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  await symlink(outsideDirectory, join(testCase.directory, "assets"));
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain(
      "image paths must stay within the input directory",
    );
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await Promise.all([
      testCase.cleanup(),
      rm(outsideDirectory, { recursive: true, force: true }),
    ]);
  }
});

test("asset inlining rejects an external candidate after a data URL srcset", async () => {
  const result = await runInlineFixture(
    '<img alt="x" srcset="data:image/png;base64,AAAA, https://example.com/x.png 2x">',
  );

  expect(result.ok).toBe(false);
});

const rejectedCss = [
  [
    "an escaped url function",
    String.raw`<style>.x { background: u\72l(https://example.com/x.png) }</style>`,
  ],
  [
    "an escaped import rule",
    String.raw`<style>@im\70ort "https://example.com/x.css";</style>`,
  ],
  [
    "an external image-set string",
    '<style>.x { background: image-set("https://example.com/x.png" 1x) }</style>',
  ],
] as const;

for (const [name, html] of rejectedCss) {
  test("asset inlining rejects " + name, async () => {
    const result = await runInlineFixture(html);

    expect(result.ok).toBe(false);
  });
}

const rejectedFinalDom = [
  [
    "an external track",
    '<video><track src="https://example.com/x.vtt"></video>',
  ],
  [
    "an external SVG image",
    '<svg><image href="https://example.com/x.png"></image></svg>',
  ],
  [
    "a mixed applet archive URL list",
    '<applet archive="data:application/java-archive;base64,AAAA https://example.com/x.jar"></applet>',
  ],
  [
    "an external attribution source",
    '<img src="data:image/png;base64,AAAA" attributionsrc="https://example.com/register">',
  ],
  ["an event handler", '<div onload="alert(1)">x</div>'],
  ["a JavaScript link", '<a href="javascript:alert(1)">x</a>'],
  [
    "an escaped external SVG filter",
    String.raw`<svg><path filter="u\72l(https://example.com/x.svg#f)"></path></svg>`,
  ],
] as const;

for (const [name, html] of rejectedFinalDom) {
  test("asset inlining rejects " + name, async () => {
    const result = await runInlineFixture(html);

    expect(result.ok).toBe(false);
  });
}

test("build reports a build failure when the temporary directory is unavailable", async () => {
  const testCase = await createCase("---\ntitle: Temporary directory\n---");
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output], {
      env: {
        ...process.env,
        TMPDIR: join(testCase.output, "missing-temporary-directory"),
      },
    });

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rpt: could not create temporary build directory\n");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});
