import { expect, test } from "bun:test";
import { mkdtemp, open, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parse,
  type DefaultTreeAdapterTypes,
} from "../dot_local/lib/rpt/node_modules/parse5/dist/index.js";
import { inlineAssets } from "../dot_local/lib/rpt/src/inline-assets.ts";
import { buildReport } from "../dot_local/lib/rpt/src/build.ts";
import { writeOutput } from "../dot_local/lib/rpt/src/output.ts";
import { validateReport } from "../dot_local/lib/rpt/src/validate.ts";

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

type TestFinalDomPolicy =
  | Readonly<{ kind: "static"; csp: string }>
  | Readonly<{
      kind: "mermaid";
      nonce: string;
      csp: string;
      cdnUrl: "https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js";
      initScript: string;
    }>;

const staticCsp =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const mermaidCdnUrl =
  "https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js" as const;
const mermaidNonce = "test-mermaid-nonce";
const mermaidInitScript = `(() => {
  const showError = (element) => {
    const error = document.createElement("p");
    error.setAttribute("role", "alert");
    error.textContent = "Mermaid diagram could not be rendered.";
    element.after(error);
  };
  const mermaid = window.mermaid;
  const elements = document.querySelectorAll("[data-rpt-mermaid]");
  if (mermaid === undefined) {
    elements.forEach(showError);
    return;
  }
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  elements.forEach(async (element, index) => {
    const source = element.textContent ?? "";
    try {
      const { svg } = await mermaid.render("rpt-mermaid-" + index, source);
      element.innerHTML = svg;
    } catch {
      showError(element);
    }
  });
})();`;
const staticPolicy: TestFinalDomPolicy = { kind: "static", csp: staticCsp };
const mermaidPolicy: TestFinalDomPolicy = {
  kind: "mermaid",
  nonce: mermaidNonce,
  csp:
    staticCsp +
    "; script-src 'nonce-" +
    mermaidNonce +
    "' https://cdn.jsdelivr.net",
  cdnUrl: mermaidCdnUrl,
  initScript: mermaidInitScript,
};

const repositoryRoot = join(import.meta.dir, "..");
const cliPath = join(repositoryRoot, "dot_local/bin/executable_rpt");

function findElement(
  parent: ParentNode,
  predicate: (element: Element) => boolean,
): Element | undefined {
  for (const child of parent.childNodes) {
    if (!("tagName" in child)) {
      continue;
    }
    if (predicate(child)) {
      return child;
    }
    const descendant = findElement(child, predicate);
    if (descendant !== undefined) {
      return descendant;
    }
  }
  return undefined;
}

function hasAttribute(element: Element, name: string, value: string): boolean {
  return element.attrs.some(
    (attribute) =>
      attribute.name.toLowerCase() === name && attribute.value === value,
  );
}

function attributeValue(element: Element, name: string): string | undefined {
  return element.attrs.find(
    (attribute) => attribute.name.toLowerCase() === name,
  )?.value;
}

function elementTextContent(element: Element): string {
  return element.childNodes
    .filter(
      (node): node is DefaultTreeAdapterTypes.TextNode =>
        node.nodeName === "#text",
    )
    .map((node) => node.value)
    .join("");
}

function collectElements(parent: ParentNode): Element[] {
  const elements: Element[] = [];
  for (const child of parent.childNodes) {
    if (!("tagName" in child)) {
      continue;
    }
    elements.push(child, ...collectElements(child));
    if ("content" in child) {
      elements.push(...collectElements(child.content));
    }
  }
  return elements;
}

function hasClass(element: Element, className: string): boolean {
  return (element.attrs.find((attribute) => attribute.name === "class")?.value ?? "")
    .split(/\s+/)
    .includes(className);
}

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

async function runRptWithTimeout(args: readonly string[]) {
  const process = Bun.spawn(["bun", cliPath, ...args], {
    cwd: repositoryRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

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

async function writePngSized(path: string, byteLength: number): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.write(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    await handle.truncate(byteLength);
  } finally {
    await handle.close();
  }
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

async function runInlineFixture(
  html: string,
  policy: TestFinalDomPolicy = staticPolicy,
  includeExpectedCsp = true,
) {
  const directory = await mkdtemp(join(tmpdir(), "rpt-inline-e2e-"));
  try {
    const csp = includeExpectedCsp
      ? `<meta http-equiv="Content-Security-Policy" content="${policy.csp}">`
      : "";
    return await inlineAssets(csp + html, directory, policy);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function mermaidScriptMarkup(
  options: Readonly<{
    cdnUrl?: string;
    cdnNonce?: string;
    initNonce?: string;
    initScript?: string;
    extraScript?: string;
    reverse?: boolean;
  }> = {},
): string {
  const cdn = `<script src="${options.cdnUrl ?? mermaidCdnUrl}" nonce="${options.cdnNonce ?? mermaidNonce}"></script>`;
  const init = `<script nonce="${options.initNonce ?? mermaidNonce}">${options.initScript ?? mermaidInitScript}</script>`;
  const scripts = options.reverse ? init + cdn : cdn + init;
  return scripts + (options.extraScript ?? "");
}

test("--help displays the rpt build usage", async () => {
  const result = await runRpt(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: rpt build <input.mdx|-> -o <output.html>");
  expect(result.stderr).toBe("");
});

test("no arguments displays the detailed AI authoring guide", async () => {
  const [result, explicitHelp] = await Promise.all([
    runRpt([]),
    runRpt(["--help"]),
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(explicitHelp.stdout);
  expect(result.stdout).toContain(
    "Turn AI-authored, restricted MDX into a self-contained HTML report.",
  );
  expect(result.stdout).toContain("Quick start:");
  expect(result.stdout).toContain("AI authoring contract:");
  expect(result.stdout).toContain("title: required non-empty string");
  expect(result.stdout).toContain("Allowed components:");
  expect(result.stdout).toContain("Callout, Metric, Evidence, Section");
  expect(result.stdout).toContain("Safe HTML:");
  expect(result.stdout).toContain(
    "Badge, Status, Icon, Timeline, TimelineItem, Tabs, Tab",
  );
  expect(result.stdout).toContain("```mermaid");
  expect(result.stdout).toContain(
    "Mermaid uses a pinned CDN and client-side JavaScript",
  );
  expect(result.stdout).toContain("class and event attributes are not allowed");
  expect(result.stdout).toContain("rpt build - -o report.html");
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
    "element script is not allowed",
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
  [
    "a Badge with an invalid tone",
    "---\ntitle: X\n---\n<Badge tone=\"other\">x</Badge>",
    "Badge.tone must be neutral, info, success, warning, or danger",
  ],
  [
    "a Status with a block child",
    "---\ntitle: X\n---\n<Status tone=\"success\">\n\nparagraph\n\n</Status>",
    "Status must contain inline content",
  ],
  [
    "an Icon with an unknown name",
    "---\ntitle: X\n---\n<Icon name=\"custom\" />",
    "Icon.name must be one of:",
  ],
  [
    "an Icon with children",
    "---\ntitle: X\n---\n<Icon name=\"check\">x</Icon>",
    "Icon must not have children",
  ],
  [
    "an Icon that is not self-closing",
    "---\ntitle: X\n---\n<Icon name=\"check\"></Icon>",
    "Icon must be self-closing",
  ],
  [
    "a Timeline with a non-TimelineItem child",
    "---\ntitle: X\n---\n<Timeline><div>x</div><TimelineItem>x</TimelineItem></Timeline>",
    "Timeline may only contain TimelineItem children",
  ],
  [
    "an icons Timeline without item icons",
    "---\ntitle: X\n---\n<Timeline theme=\"icons\"><TimelineItem>x</TimelineItem><TimelineItem>y</TimelineItem></Timeline>",
    "Timeline theme icons requires every TimelineItem.icon",
  ],
  [
    "Tabs with one Tab",
    "---\ntitle: X\n---\n<Tabs><Tab label=\"A\">a</Tab></Tabs>",
    "Tabs must contain between 2 and 10 Tab children",
  ],
  [
    "Tabs with two active Tabs",
    "---\ntitle: X\n---\n<Tabs><Tab label=\"A\" active=\"true\">a</Tab><Tab label=\"B\" active=\"true\">b</Tab></Tabs>",
    "Tabs may only contain one active Tab",
  ],
  [
    "nested Tabs",
    "---\ntitle: X\n---\n<Tabs><Tab label=\"A\"><Tabs><Tab label=\"B\">b</Tab><Tab label=\"C\">c</Tab></Tabs></Tab><Tab label=\"D\">d</Tab></Tabs>",
    "Tabs must not be nested",
  ],
  [
    "a Tab with an internal prop",
    "---\ntitle: X\n---\n<Tabs><Tab label=\"A\" group=\"user\">a</Tab><Tab label=\"B\">b</Tab></Tabs>",
    "attribute group is not allowed on Tab",
  ],
] as const;

test("build renders safe semantic HTML without executable content", async () => {
  const testCase = await createCase(
    "---\ntitle: Safe HTML\n---\n\n<section id=\"details\" role=\"region\" aria-label=\"詳細\" style=\"display: grid; gap: 1rem\">\n  <details open=\"true\">\n    <summary>内訳</summary>\n    <table><tbody><tr><th scope=\"row\">状態</th><td>正常</td></tr></tbody></table>\n  </details>\n</section>",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    const document = parse(await Bun.file(testCase.output).text());
    const section = findElement(
      document,
      (element) => element.tagName === "section" && attributeValue(element, "id") === "details",
    );
    expect(section).toBeDefined();
    expect(attributeValue(section!, "aria-label")).toBe("詳細");
    expect(attributeValue(section!, "style")).toContain("display: grid");
    expect(collectElements(document).some((element) => element.tagName === "script")).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

const rejectedSafeHtml = [
  ["script", "<script>alert(1)</script>", "element script is not allowed"],
  ["class", '<div class="x">x</div>', "attribute class is not allowed on div"],
  ["event", '<div onClick="x">x</div>', "attribute onClick is not allowed on div"],
  ["raw image", '<img src="x.png" />', "element img is not allowed"],
  ["heading", "<h2>Hidden outline</h2>", "element h2 is not allowed"],
  ["reserved id", '<div id="rpt-user">x</div>', "id prefix rpt- is reserved"],
  ["duplicate id", '<div id="same">a</div><span id="same">b</span>', "id may only be specified once"],
  ["invalid child", "<ul><div>x</div></ul>", "ul may only contain li elements"],
  ["invalid description child", "<dl><div>x</div></dl>", "dl may only contain dt and dd elements"],
  ["invalid description order", "<dl><dd>x</dd><dt>term</dt></dl>", "dl elements are in an invalid order"],
  ["details body before summary", "<details>body<summary>Summary</summary></details>", "summary must be the first element in details"],
  ["unsafe style", '<div style="position: fixed">x</div>', "style property position is not allowed"],
  ["unsafe HTML URL with a tab", '<a href="java\tscript:alert(1)">x</a>', "href URL is not allowed"],
] as const;

for (const [name, html, message] of rejectedSafeHtml) {
  test("build rejects unsafe HTML " + name + " before creating an output file", async () => {
    const testCase = await createCase("---\ntitle: X\n---\n" + html);
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

const rejectedAriaReferences = [
  ["aria-labelledby", '<div aria-labelledby="missing-one missing-two">x</div>'],
  ["aria-describedby", '<div aria-describedby="missing">x</div>'],
  ["aria-details", '<div aria-details="missing">x</div>'],
  ["aria-controls", '<div aria-controls="missing-one missing-two">x</div>'],
  ["aria-owns", '<div aria-owns="missing">x</div>'],
  ["aria-flowto", '<div aria-flowto="missing">x</div>'],
  ["aria-activedescendant", '<div aria-activedescendant="missing">x</div>'],
  ["aria-errormessage", '<div aria-errormessage="missing">x</div>'],
  ["an empty aria ID reference", '<div aria-controls="">x</div>'],
] as const;

for (const [name, html] of rejectedAriaReferences) {
  test("build rejects unresolved " + name + " as an input error", async () => {
    const testCase = await createCase("---\ntitle: X\n---\n" + html);
    try {
      const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

      expect(result.exitCode).toBe(3);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^rpt: \d+:\d+:/);
      expect(result.stderr).toContain("ARIA reference");
      expect(await Bun.file(testCase.output).exists()).toBe(false);
    } finally {
      await testCase.cleanup();
    }
  });
}

test("build rejects Markdown links with C0 controls in the scheme", async () => {
  const testCase = await createCase(
    "---\ntitle: X\n---\n[unsafe](java&#x09;script:alert(1))",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toMatch(/^rpt: \d+:\d+:/);
    expect(result.stderr).toContain("link URL is not allowed");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

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

const rejectedMermaid = [
  [
    "oversized diagram",
    "x".repeat(64 * 1024 + 1),
    "Mermaid diagram exceeds the 64 KiB limit",
  ],
  [
    "frontmatter",
    "---\ntheme: dark\n---\nflowchart LR\nA-->B",
    "Mermaid frontmatter is not allowed",
  ],
  [
    "init directive",
    '%%{init: {"theme":"dark"}}%%\nflowchart LR\nA-->B',
    "Mermaid init directives are not allowed",
  ],
  [
    "init directive with whitespace and mixed case",
    "%% { InIt: {\"theme\":\"dark\"} } %%\nflowchart LR\nA-->B",
    "Mermaid init directives are not allowed",
  ],
  [
    "init directive after a Mermaid comment",
    "%% harmless comment\n%% { InIt : {\"theme\":\"dark\"} } %%\nflowchart LR\nA-->B",
    "Mermaid init directives are not allowed",
  ],
  [
    "initialize directive after a Mermaid comment",
    "%% harmless comment\n%%{INITIALIZE: {\"theme\":\"dark\"}}%%\nflowchart LR\nA-->B",
    "Mermaid init directives are not allowed",
  ],
] as const;

for (const [name, diagram, message] of rejectedMermaid) {
  test("build rejects Mermaid " + name + " before creating an output file", async () => {
    const testCase = await createCase(
      "---\ntitle: X\n---\n```mermaid\n" + diagram + "\n```",
    );
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

test("build rejects more than 20 Mermaid diagrams before creating an output file", async () => {
  const diagram = "```mermaid\nflowchart LR\nA-->B\n```";
  const testCase = await createCase(
    "---\ntitle: X\n---\n" + Array.from({ length: 21 }, () => diagram).join("\n\n"),
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^rpt: \d+:\d+:/);
    expect(result.stderr).toContain("Mermaid diagrams exceed the 20 diagram limit");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

test("build treats case-variant Mermaid fences as ordinary code", async () => {
  const testCase = await createCase(
    "---\ntitle: X\n---\n```Mermaid\n%%{init: {\"theme\":\"dark\"}}%%\nflowchart LR\nA-->B\n```",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(await Bun.file(testCase.output).text()).toContain("flowchart LR");
  } finally {
    await testCase.cleanup();
  }
});

test("validateReport derives hasMermaid and rejects user-provided metadata", () => {
  const mermaid = validateReport({
    source: "---\ntitle: X\n---\n```mermaid\nflowchart LR\nA-->B\n```",
    baseDirectory: repositoryRoot,
  });
  expect(mermaid.ok).toBe(true);
  if (mermaid.ok) {
    expect(mermaid.value.hasMermaid).toBe(true);
  }

  const ordinaryCode = validateReport({
    source: "---\ntitle: X\n---\n```Mermaid\nflowchart LR\nA-->B\n```",
    baseDirectory: repositoryRoot,
  });
  expect(ordinaryCode.ok).toBe(true);
  if (ordinaryCode.ok) {
    expect(ordinaryCode.value.hasMermaid).toBe(false);
  }

  const userMetadata = validateReport({
    source: "---\ntitle: X\nhasMermaid: true\n---",
    baseDirectory: repositoryRoot,
  });
  expect(userMetadata.ok).toBe(false);
  if (!userMetadata.ok) {
    expect(userMetadata.error.message).toBe("frontmatter.hasMermaid is not allowed");
  }
});

test("build writes validator-derived Mermaid metadata", async () => {
  const report = validateReport({
    source: "---\ntitle: X\n---\n```mermaid\nflowchart LR\nA-->B\n```",
    baseDirectory: repositoryRoot,
  });
  expect(report.ok).toBe(true);
  if (!report.ok) {
    return;
  }

  const built = await buildReport(report.value, join(repositoryRoot, "dot_local/lib/rpt"));
  expect(built.ok).toBe(true);
  if (!built.ok) {
    return;
  }
  try {
    const metadata = JSON.parse(
      await Bun.file(
        join(built.value.distDirectory, "..", "src/content/report-data.json"),
      ).text(),
    ) as { hasMermaid?: unknown };
    expect(metadata.hasMermaid).toBe(true);
  } finally {
    await built.value.cleanup();
  }
});

test("Tabs receive unique internal radio props in validated source", () => {
  const result = validateReport({
    source:
      "---\ntitle: X\n---\n<Tabs><Tab label=\"A\" active=\"true\">a</Tab><Tab label=\"B\">b</Tab></Tabs>\n\n<Tabs><Tab label=\"C\">c</Tab><Tab label=\"D\">d</Tab></Tabs>",
    baseDirectory: repositoryRoot,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.value.source).toContain(
    '<Tab label="A" active="true" group="rpt-tabs-1" controlId="rpt-tab-control-1-1" labelId="rpt-tab-label-1-1" panelId="rpt-tab-panel-1-1" checked="true">',
  );
  expect(result.value.source).toContain(
    '<Tab label="B" group="rpt-tabs-1" controlId="rpt-tab-control-1-2" labelId="rpt-tab-label-1-2" panelId="rpt-tab-panel-1-2" checked="false">',
  );
  expect(result.value.source).toContain(
    '<Tab label="C" group="rpt-tabs-2" controlId="rpt-tab-control-2-1" labelId="rpt-tab-label-2-1" panelId="rpt-tab-panel-2-1" checked="true">',
  );
});

test("Tabs and Timeline ignore whitespace-only direct children", () => {
  const result = validateReport({
    source: `---
title: X
---
<Timeline theme="icons">
  <TimelineItem title="調査" icon="search">要件を確認します。</TimelineItem>
  <TimelineItem title="実装" icon="check">機能を追加します。</TimelineItem>
</Timeline>
<Tabs>
  <Tab label="概要" active="true">概要本文</Tab>
  <Tab label="詳細">詳細本文</Tab>
</Tabs>`,
    baseDirectory: repositoryRoot,
  });

  expect(result.ok).toBe(true);
});

test("rich components render static accessible markup without scripts", async () => {
  const testCase = await createCase(`---
title: Rich components
---

<Badge tone="success">承認済み</Badge>
<Status tone="warning">確認待ち</Status>
<Icon name="circle-check" label="完了" size="20" />
<Icon name="info" />
<Timeline theme="icons">
  <TimelineItem title="調査" icon="search">要件を確認します。</TimelineItem>
  <TimelineItem title="実装" icon="check">機能を追加します。</TimelineItem>
</Timeline>
<Tabs>
  <Tab label="概要" active="true">概要本文</Tab>
  <Tab label="詳細">詳細本文</Tab>
</Tabs>`);
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const html = await Bun.file(testCase.output).text();
    const document = parse(html);
    const components = collectElements(document).filter((element) =>
      element.attrs.some((attribute) => attribute.name === "data-rpt-component"),
    );
    for (const component of [
      "badge",
      "status",
      "icon",
      "timeline",
      "timeline-item",
      "tabs",
      "tab",
    ]) {
      expect(
        components.some(
          (element) => attributeValue(element, "data-rpt-component") === component,
        ),
      ).toBe(true);
    }
    expect(
      components.some(
        (element) =>
          attributeValue(element, "data-rpt-component") === "badge" &&
          attributeValue(element, "data-tone") === "success",
      ),
    ).toBe(true);
    expect(
      components.some(
        (element) =>
          attributeValue(element, "data-rpt-component") === "status" &&
          attributeValue(element, "data-tone") === "warning",
      ),
    ).toBe(true);

    expect(
      components.some(
        (element) =>
          attributeValue(element, "data-rpt-component") === "icon" &&
          hasAttribute(element, "role", "img") &&
          hasAttribute(element, "aria-label", "完了"),
      ),
    ).toBe(true);
    expect(
      components.some(
        (element) =>
          attributeValue(element, "data-rpt-component") === "icon" &&
          hasAttribute(element, "aria-hidden", "true"),
      ),
    ).toBe(true);

    const timeline = components.find(
      (element) => attributeValue(element, "data-rpt-component") === "timeline",
    );
    expect(timeline).toBeDefined();
    if (timeline === undefined) {
      return;
    }
    const timelineList = findElement(
      timeline,
      (element) => element.tagName === "ul",
    );
    expect(timelineList).toBeDefined();
    expect(
      collectElements(timelineList!).filter((element) => element.tagName === "li"),
    ).toHaveLength(2);

    const controls = collectElements(document).filter(
      (element) =>
        element.tagName === "input" &&
        hasClass(element, "rpt-tab-control") &&
        hasAttribute(element, "type", "radio"),
    );
    expect(controls).toHaveLength(2);
    expect(attributeValue(controls[0]!, "name")).toBe(attributeValue(controls[1]!, "name"));
    expect(controls.filter((control) => hasAttribute(control, "checked", ""))).toHaveLength(1);
    for (const control of controls) {
      const controlId = attributeValue(control, "id");
      const panelId = attributeValue(control, "aria-controls");
      expect(controlId).toBeDefined();
      expect(panelId).toBeDefined();
      const label = findElement(
        document,
        (element) =>
          element.tagName === "label" &&
          hasClass(element, "rpt-tab-label") &&
          hasAttribute(element, "for", controlId!),
      );
      expect(label).toBeDefined();
      expect(
        findElement(
          document,
          (element) =>
            element.tagName === "section" &&
            hasClass(element, "rpt-tab-panel") &&
            hasAttribute(element, "id", panelId!) &&
            hasAttribute(element, "aria-labelledby", attributeValue(label!, "id")!),
        ),
      ).toBeDefined();
    }
    const panels = collectElements(document).filter(
      (element) =>
        element.tagName === "section" && hasClass(element, "rpt-tab-panel"),
    );
    expect(panels.map((panel) => attributeValue(panel, "data-label"))).toEqual([
      "概要",
      "詳細",
    ]);
    expect(html).toMatch(
      /@media\s*print\s*\{[\s\S]*?\.rpt-tab-panel\s*\{\s*display:\s*block/,
    );
    expect(html).not.toContain("--w-color-secondary");
    expect(html).not.toContain("--w-color-on-info");
    expect(html).toContain("var(--w-color-primary-50)");
    expect(html).toContain("var(--w-color-info-fg)");
    expect(collectElements(document).filter((element) => element.tagName === "script")).toHaveLength(0);
  } finally {
    await testCase.cleanup();
  }
});

const rejectedRasterDataUrls = [
  [
    "SVG",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data URL image MIME type is not allowed",
  ],
  [
    "an unknown MIME type",
    "data:image/bmp;base64,Qk0=",
    "data URL image MIME type is not allowed",
  ],
  [
    "a non-base64 payload",
    "data:image/png,iVBORw0KGgo=",
    "data URL images must use base64",
  ],
  [
    "invalid base64",
    "data:image/png;base64,!!!!",
    "data URL image contains invalid base64",
  ],
  [
    "non-canonical base64 padding bits",
    "data:image/png;base64,iVBORw0KGgp=",
    "data URL image contains invalid base64",
  ],
  [
    "bytes that do not match the declared MIME type",
    "data:image/jpeg;base64,iVBORw0KGgo=",
    "data URL image MIME type does not match its bytes",
  ],
] as const;

for (const [name, dataUrl, message] of rejectedRasterDataUrls) {
  test("raster data URLs reject " + name + " before Astro build", async () => {
    const testCase = await createCase(
      `---\ntitle: Invalid data image\n---\n\n![image](${dataUrl})`,
    );
    try {
      const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

      expect(result.exitCode).toBe(3);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(message);
      expect(await Bun.file(testCase.output).exists()).toBe(false);
    } finally {
      await testCase.cleanup();
    }
  });
}

test("raster data URLs preserve allowed base64 images in the single HTML", async () => {
  const images = [
    ["png", "data:image/png;base64,iVBORw0KGgo="],
    ["jpeg", "data:image/jpeg;base64,/9j/"],
    ["gif", "data:image/gif;base64,R0lGODdh"],
    ["webp", "data:image/webp;base64,UklGRgAAAABXRUJQ"],
    ["avif", "data:image/avif;base64,AAAADGZ0eXBhdmlm"],
  ] as const;
  const source =
    "---\ntitle: Raster data images\n---\n\n" +
    images.map(([name, dataUrl]) => `![${name}](${dataUrl})`).join("\n\n");
  const testCase = await createCase(source);
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const html = await Bun.file(testCase.output).text();
    for (const [, dataUrl] of images) {
      expect(html).toContain(`src="${dataUrl}"`);
    }
  } finally {
    await testCase.cleanup();
  }
});

test("raster data URL bytes count toward the 20 MiB image total", async () => {
  const dataImageBytes = new Uint8Array(1024 * 1024 + 1);
  dataImageBytes.set(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  const dataUrl =
    "data:image/png;base64," + Buffer.from(dataImageBytes).toString("base64");
  const localImageNames = ["one", "two", "three", "four"] as const;
  const source =
    "---\ntitle: Combined image total\n---\n\n" +
    `![inline](${dataUrl})\n\n` +
    localImageNames
      .map((name) => `![${name}](./${name}.png)`)
      .join("\n\n");
  const testCase = await createCase(source);
  await Promise.all(
    localImageNames.map((name) =>
      writePngSized(
        join(testCase.directory, name + ".png"),
        (19 * 1024 * 1024) / 4,
      ),
    ),
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("images exceed the 20 MiB total limit");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

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

test("bounded descriptors reject non-regular file inputs without waiting for data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpt-e2e-"));
  const fifo = join(directory, "report.fifo");
  const mkfifo = Bun.spawn(["mkfifo", fifo], { stdout: "pipe", stderr: "pipe" });
  const [mkfifoExitCode, mkfifoStderr] = await Promise.all([
    mkfifo.exited,
    new Response(mkfifo.stderr).text(),
  ]);
  expect(mkfifoExitCode).toBe(0);
  expect(mkfifoStderr).toBe("");

  try {
    for (const [name, input] of [
      ["directory", directory],
      ["device", "/dev/null"],
      ["FIFO", fifo],
    ] as const) {
      const output = join(directory, name + ".html");
      const result = await runRptWithTimeout(["build", input, "-o", output]);

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(5);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("input must be a regular file");
      expect(await Bun.file(output).exists()).toBe(false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bounded descriptors reject a local image over 5 MiB", async () => {
  const testCase = await createCase(
    "---\ntitle: Oversized image\n---\n\n![large](./large.png)",
  );
  await writePngSized(join(testCase.directory, "large.png"), 5 * 1024 * 1024 + 1);
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("image exceeds the 5 MiB limit");
    expect(await Bun.file(testCase.output).exists()).toBe(false);
  } finally {
    await testCase.cleanup();
  }
});

test("bounded descriptors reject more than 20 MiB of local images", async () => {
  const imageNames = ["one", "two", "three", "four", "five"] as const;
  const source =
    "---\ntitle: Too many images\n---\n\n" +
    imageNames.map((name) => `![${name}](./${name}.png)`).join("\n\n");
  const testCase = await createCase(source);
  await Promise.all(
    imageNames.map((name) =>
      writePngSized(join(testCase.directory, name + ".png"), 4 * 1024 * 1024 + 1),
    ),
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("images exceed the 20 MiB total limit");
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
    const elements = collectElements(parse(html));
    expect(elements.filter((element) => element.tagName === "script")).toHaveLength(0);
    expect(
      elements.filter(
        (element) =>
          element.tagName === "meta" &&
          attributeValue(element, "http-equiv")?.toLowerCase() ===
            "content-security-policy",
      ).map((element) => attributeValue(element, "content")),
    ).toEqual([staticCsp]);
    expect(
      elements.filter(
        (element) =>
          element.tagName === "link" ||
          ((element.tagName === "img" || element.tagName === "source") &&
            !attributeValue(element, "src")?.startsWith("data:")),
      ),
    ).toHaveLength(0);
  } finally {
    await testCase.cleanup();
  }
});

test("build renders Mermaid with only the fixed CDN and nonce-bound init script", async () => {
  const testCase = await createCase(
    "---\ntitle: Mermaid report\n---\n\n```mermaid\nflowchart LR\nA-->B\n```",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const html = await Bun.file(testCase.output).text();
    const elements = collectElements(parse(html));
    const scripts = elements.filter((element) => element.tagName === "script");
    const csp = elements.filter(
      (element) =>
        element.tagName === "meta" &&
        attributeValue(element, "http-equiv")?.toLowerCase() ===
          "content-security-policy",
    );

    expect(scripts).toHaveLength(2);
    expect(attributeValue(scripts[0]!, "src")).toBe(mermaidCdnUrl);
    expect(attributeValue(scripts[0]!, "nonce")).toBeTruthy();
    expect(attributeValue(scripts[1]!, "nonce")).toBe(
      attributeValue(scripts[0]!, "nonce"),
    );
    expect(attributeValue(scripts[1]!, "src")).toBeUndefined();
    expect(elementTextContent(scripts[1]!)).toBe(mermaidInitScript);
    expect(csp).toHaveLength(1);
    expect(attributeValue(csp[0]!, "content")).toBe(
      staticCsp +
        "; script-src 'nonce-" +
        attributeValue(scripts[0]!, "nonce") +
        "' https://cdn.jsdelivr.net",
    );
    expect(attributeValue(csp[0]!, "content")).toContain("connect-src 'none'");
    expect(attributeValue(csp[0]!, "content")).toContain("object-src 'none'");
    expect(attributeValue(csp[0]!, "content")).toContain("base-uri 'none'");
    expect(html).toContain("data-rpt-mermaid");
    expect(html).toContain('securityLevel: "strict"');
    expect(html).toContain("flowchart LR");
  } finally {
    await testCase.cleanup();
  }
});

test("final DOM resolves skip, outline, and footnote fragments to unique ids", async () => {
  const testCase = await createCase(
    "---\ntitle: Final DOM ids\n---\n\n## report-content\n\nHeading body.[^1]\n\n## section-findings\n\nHeading with a Section-shaped ID.\n\n<Section title=\"Findings\">\nSection body.\n</Section>\n\n<Evidence title=\"External\" source=\"https://example.com/evidence#result\">Evidence body.</Evidence>\n\n[^1]: Footnote text.",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    const html = await Bun.file(testCase.output).text();
    const document = parse(html);
    const elements = collectElements(document);
    const ids = elements
      .map((element) => attributeValue(element, "id"))
      .filter((id): id is string => id !== undefined);
    const fragmentHrefs = elements
      .filter((element) => element.tagName === "a")
      .map((element) => attributeValue(element, "href"))
      .filter((href): href is string => href?.startsWith("#") === true);
    const main = elements.find((element) => element.tagName === "main");
    const skipLink = elements.find(
      (element) =>
        element.tagName === "a" && hasClass(element, "rpt-skip-link"),
    );

    expect(new Set(ids).size).toBe(ids.length);
    for (const href of fragmentHrefs) {
      const target = decodeURIComponent(href.slice(1));
      expect(ids.filter((id) => id === target)).toHaveLength(1);
    }
    const mainId = main === undefined ? undefined : attributeValue(main, "id");
    expect(mainId).toBeDefined();
    expect(mainId).not.toBe("report-content");
    expect(attributeValue(skipLink!, "href")).toBe("#" + mainId);
    expect(fragmentHrefs).toContain("#report-content");
    expect(fragmentHrefs).toContain("#section-findings-1");
    expect(fragmentHrefs.some((href) => href.includes("user-content-fn"))).toBe(
      true,
    );
    expect(
      elements.some(
        (element) =>
          element.tagName === "a" &&
          attributeValue(element, "href") ===
            "https://example.com/evidence#result",
      ),
    ).toBe(true);
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
  [
    "a variable reference inside an asset function",
    '<style>:root { --asset: "https://example.com/x.png" } .x { background-image: image-set(var(--asset) 1x) }</style>',
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
  [
    "an SVG SMIL URL mutation",
    '<svg><image href="data:image/png;base64,AAAA"><set attributeName="href" to="https://example.com/x.png" begin="0s" dur="indefinite"></set></image></svg>',
  ],
  [
    "a legacy applet code URL",
    '<applet code="https://example.com/x.class"></applet>',
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

const rejectedFinalDomAriaReferences = [
  ["aria-labelledby", '<div aria-labelledby="missing"></div>'],
  ["aria-describedby", '<div aria-describedby="missing"></div>'],
  ["aria-details", '<div aria-details="missing"></div>'],
  ["aria-controls", '<div aria-controls="missing"></div>'],
  ["aria-owns", '<div aria-owns="missing"></div>'],
  ["aria-flowto", '<div aria-flowto="missing"></div>'],
  ["aria-activedescendant", '<div aria-activedescendant="missing"></div>'],
  ["aria-errormessage", '<div aria-errormessage="missing"></div>'],
  ["an empty reference", '<div aria-controls=""></div>'],
] as const;

for (const [name, html] of rejectedFinalDomAriaReferences) {
  test("final DOM rejects unresolved " + name + " ARIA references", async () => {
    const result = await runInlineFixture(html);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("ARIA reference");
    }
  });
}

test("final DOM accepts only the complete Mermaid script and CSP policy", async () => {
  const result = await runInlineFixture(
    '<pre data-rpt-mermaid><code class="language-mermaid">flowchart LR\nA--&gt;B</code></pre>' +
      mermaidScriptMarkup(),
    mermaidPolicy,
  );

  expect(result.ok).toBe(true);
});

const rejectedScriptPolicies = [
  [
    "any script under the static policy",
    "<script>alert(1)</script>",
    staticPolicy,
  ],
  [
    "a different Mermaid CDN URL",
    mermaidScriptMarkup({
      cdnUrl: "https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js",
    }),
    mermaidPolicy,
  ],
  [
    "a Mermaid CDN nonce mismatch",
    mermaidScriptMarkup({ cdnNonce: "different-nonce" }),
    mermaidPolicy,
  ],
  [
    "a Mermaid init nonce mismatch",
    mermaidScriptMarkup({ initNonce: "different-nonce" }),
    mermaidPolicy,
  ],
  [
    "a third Mermaid script",
    mermaidScriptMarkup({ extraScript: '<script nonce="test-mermaid-nonce"></script>' }),
    mermaidPolicy,
  ],
  [
    "reversed Mermaid script order",
    mermaidScriptMarkup({ reverse: true }),
    mermaidPolicy,
  ],
  [
    "a one-character Mermaid init mutation",
    mermaidScriptMarkup({
      initScript: mermaidInitScript.replace("rendered.", "rendered!"),
    }),
    mermaidPolicy,
  ],
  [
    "Mermaid scripts in the SVG namespace",
    "<svg>" + mermaidScriptMarkup() + "</svg>",
    mermaidPolicy,
  ],
] as const;

for (const [name, html, policy] of rejectedScriptPolicies) {
  test("final DOM rejects " + name, async () => {
    const result = await runInlineFixture(html, policy);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("script");
    }
  });
}

test("final DOM rejects a missing CSP meta", async () => {
  const result = await runInlineFixture("<main>body</main>", staticPolicy, false);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).toContain("Content Security Policy");
  }
});

test("final DOM rejects multiple CSP metas", async () => {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${staticCsp}">`;
  const result = await runInlineFixture(cspMeta + cspMeta, staticPolicy, false);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).toContain("Content Security Policy");
  }
});

test("final DOM rejects a CSP that differs from the policy", async () => {
  const result = await runInlineFixture(
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">',
    staticPolicy,
    false,
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).toContain("Content Security Policy");
  }
});

test("final DOM rejects a CSP meta outside the document head", async () => {
  const result = await runInlineFixture(
    `<!doctype html><html><head></head><body><main>body</main><meta http-equiv="Content-Security-Policy" content="${staticCsp}"></body></html>`,
    staticPolicy,
    false,
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).toContain("Content Security Policy");
  }
});

for (const [name, html] of [
  ["aria-labelledby", '<div aria-labelledby="missing"></div>'],
  ["aria-describedby", '<div aria-describedby="missing"></div>'],
  ["aria-details", '<div aria-details="missing"></div>'],
] as const) {
  test("policy-aware final DOM rejects unresolved " + name, async () => {
    const result = await runInlineFixture(html, staticPolicy);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("ARIA reference");
    }
  });
}

test("final DOM rejects C0 controls in navigation URL schemes", async () => {
  const result = await runInlineFixture('<a href="java\tscript:alert(1)">x</a>');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).toContain("unsafe navigation URL");
  }
});

test("final DOM rejects duplicate ids", async () => {
  const result = await runInlineFixture(
    '<h2 id="duplicate">Heading</h2><main id="duplicate">Body</main>',
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).toContain("duplicate id");
  }
});

test("final DOM rejects an internal fragment without one target", async () => {
  const result = await runInlineFixture(
    '<main id="present">Body</main><a href="#missing">Missing</a>',
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).toContain(
      "internal fragment must resolve to exactly one id",
    );
  }
});

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

test("build omits read failures from normal output and includes their cause with --debug", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpt-e2e-"));
  const input = join(directory, "missing.mdx");
  const output = join(directory, "report.html");
  try {
    const normal = await runRpt(["build", input, "-o", output]);
    const debug = await runRpt(["build", input, "-o", output, "--debug"]);

    expect(normal.exitCode).toBe(5);
    expect(normal.stderr).toBe(`rpt: 1:1: could not read input: ${input}\n`);
    expect(normal.stderr).not.toContain("ENOENT");
    expect(debug.exitCode).toBe(5);
    expect(debug.stderr).toContain(`rpt: 1:1: could not read input: ${input}\n`);
    expect(debug.stderr).toContain("ENOENT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("build supports long URLs, code blocks, GFM tables, and footnotes", async () => {
  const longUrl = "https://example.com/" + "reference/".repeat(40);
  const testCase = await createCase(
    `---\ntitle: Rich Markdown\n---\n\n[Long reference](${longUrl})\n\n\`\`\`\nconst answer = 42;\n\`\`\`\n\n| Item | Value |\n| --- | ---: |\n| answer | 42 |\n\nA sourced statement.[^1]\n\n[^1]: Footnote text.`,
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const html = await Bun.file(testCase.output).text();
    expect(html).toContain(`href="${longUrl}"`);
    expect(html).toContain("const answer = 42;");
    expect(html).toContain("<table>");
    expect(html).toContain("Footnote text.");
  } finally {
    await testCase.cleanup();
  }
});

test("build includes responsive print CSS and accessible report landmarks", async () => {
  const testCase = await createCase(
    "---\ntitle: Accessible report\n---\n\n<Callout tone=\"danger\">Take care.</Callout>",
  );
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    const html = await Bun.file(testCase.output).text();
    expect(html).toMatch(/@media\s*\(\s*max-width\s*:\s*48rem\s*\)/);
    expect(html).toContain("@media print");
    expect(html).toContain("@page");
    const document = parse(html);
    expect(
      findElement(
        document,
        (element) =>
          element.tagName === "nav" &&
          hasClass(element, "rpt-toc") &&
          hasAttribute(element, "aria-label", "目次"),
      ),
    ).toBeDefined();
    expect(
      findElement(
        document,
        (element) =>
          element.tagName === "a" &&
          hasClass(element, "rpt-skip-link") &&
          hasAttribute(element, "href", "#report-content"),
      ),
    ).toBeDefined();
    expect(html).toContain('<main id="report-content">');
    expect(html).toContain('<article class="rpt-article">');
    expect(html).toMatch(/class="[^"]*_alert_[^"]*"/);
  } finally {
    await testCase.cleanup();
  }
});

test("build leaves no generated temporary files beside its output", async () => {
  const testCase = await createCase("---\ntitle: Clean output\n---\n\nReport body.");
  try {
    const result = await runRpt(["build", testCase.input, "-o", testCase.output]);

    expect(result.exitCode).toBe(0);
    expect((await readdir(testCase.directory)).sort()).toEqual([
      "report.html",
      "report.mdx",
    ]);
  } finally {
    await testCase.cleanup();
  }
});
