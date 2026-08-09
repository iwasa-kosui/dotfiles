import { isAbsolute, relative, resolve, sep } from "node:path";
import GithubSlugger from "github-slugger";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { parseDocument } from "yaml";
import { validateComponent } from "./component-rules.ts";
import { decodeRasterDataUrl } from "./image.ts";
import { maximumTotalImageBytes } from "./limits.ts";
import {
  validateMermaidNode,
  type MermaidValidationState,
} from "./mermaid.ts";
import {
  safeHtmlAriaReferences,
  validateSafeHtmlElement,
  type AriaIdReference,
} from "./safe-html.ts";
import { isAllowedNavigationUrl } from "./safe-url.ts";
import type { ReportInput } from "./input.ts";
import type { Result } from "./result.ts";
import type { Positioned, TreeNode } from "./validation-types.ts";

export type ReportMetadata = Readonly<{
  title: string;
  summary?: string;
  author?: string;
  createdAt?: string;
  status?: "draft" | "final" | "archived";
  tags?: readonly string[];
}>;

export type OutlineItem = Readonly<{
  depth: 2 | 3;
  text: string;
  slug: string;
}>;

export type AssetReference = Readonly<{
  sourcePath: string;
  relativePath: string;
}>;

export type ValidatedReport = Readonly<{
  source: string;
  baseDirectory: string;
  metadata: ReportMetadata;
  outline: readonly OutlineItem[];
  assets: readonly AssetReference[];
  decodedDataImageBytes: number;
  mainContentId: string;
  hasMermaid: boolean;
}>;

type ValidationState = {
  readonly source: string;
  readonly headingSlugger: GithubSlugger;
  readonly htmlIds: Set<string>;
  readonly outline: OutlineItem[];
  readonly assets: AssetReference[];
  readonly assetPaths: Set<string>;
  readonly imageReferenceIdentifiers: Set<string>;
  readonly ariaReferences: AriaIdReference[];
  readonly sourceInsertions: Array<Readonly<{ offset: number; text: string }>>;
  tabsGroupCount: number;
  decodedDataImageBytes: number;
  readonly mermaid: MermaidValidationState;
};

const allowedFrontmatter = new Set([
  "title",
  "summary",
  "author",
  "createdAt",
  "status",
  "tags",
]);

export function validateReport(input: ReportInput): Result<ValidatedReport> {
  let tree: TreeNode;
  try {
    tree = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(remarkFrontmatter, ["yaml"])
      .use(remarkGfm)
      .parse(input.source);
  } catch (cause) {
    return inputFailure(
      "MDX syntax is invalid",
      positionFromError(cause),
      cause,
    );
  }

  const metadata = readMetadata(tree);
  if (!metadata.ok) {
    return metadata;
  }

  const state: ValidationState = {
    source: input.source,
    headingSlugger: new GithubSlugger(),
    htmlIds: collectMarkdownHeadingIds(tree),
    outline: [],
    assets: [],
    assetPaths: new Set(),
    imageReferenceIdentifiers: collectImageReferenceIdentifiers(tree),
    ariaReferences: [],
    sourceInsertions: [],
    tabsGroupCount: 0,
    decodedDataImageBytes: 0,
    mermaid: { count: 0, hasMermaid: false },
  };
  const validation = validateNode(tree, undefined, undefined, 0, 0, 0, input, state);
  if (!validation.ok) {
    return validation;
  }
  const ariaValidation = validateAriaReferences(state);
  if (!ariaValidation.ok) {
    return ariaValidation;
  }
  const mainContentId = allocateHtmlId("report-content", state.htmlIds);

  return {
    ok: true,
    value: {
      source: insertSource(input.source, state.sourceInsertions),
      baseDirectory: input.baseDirectory,
      metadata: metadata.value,
      outline: state.outline,
      assets: state.assets,
      decodedDataImageBytes: state.decodedDataImageBytes,
      mainContentId,
      hasMermaid: state.mermaid.hasMermaid,
    },
  };
}

function readMetadata(tree: TreeNode): Result<ReportMetadata> {
  const yamlNodes = (tree.children ?? []).filter((node) => node.type === "yaml");
  if (yamlNodes.length > 1) {
    return inputFailure("only one frontmatter block is allowed", yamlNodes[1]);
  }

  const yaml = yamlNodes[0];
  if (yaml !== undefined && tree.children?.[0] !== yaml) {
    return inputFailure("frontmatter must be the first document node", yaml);
  }

  let value: unknown = {};
  if (yaml !== undefined) {
    const document = parseDocument(yaml.value ?? "", { uniqueKeys: true });
    const parseError = document.errors[0];
    if (parseError !== undefined) {
      const linePosition = parseError.linePos?.[0];
      const location =
        linePosition === undefined
          ? locationOf(yaml)
          : {
              line: (yaml.position?.start.line ?? 1) + linePosition.line - 1,
              column: linePosition.col,
            };
      return inputFailure(
        "frontmatter is invalid: " + parseError.message,
        location,
        parseError,
      );
    }
    try {
      value = document.toJS({ maxAliasCount: 0 });
    } catch (cause) {
      return inputFailure("frontmatter is invalid", yaml, cause);
    }
  }

  if (!isRecord(value)) {
    return inputFailure("frontmatter must be a mapping", yaml);
  }

  for (const key of Object.keys(value)) {
    if (!allowedFrontmatter.has(key)) {
      return inputFailure("frontmatter." + key + " is not allowed", yaml);
    }
  }

  const title = value.title;
  if (title === undefined || title === null || title === "") {
    return inputFailure("frontmatter.title is required", yaml);
  }
  if (typeof title !== "string" || title.trim() === "") {
    return inputFailure("frontmatter.title must be a non-empty string", yaml);
  }

  const summary = optionalString(value, "summary", yaml);
  if (!summary.ok) {
    return summary;
  }
  const author = optionalString(value, "author", yaml);
  if (!author.ok) {
    return author;
  }

  const createdAt = value.createdAt;
  if (
    createdAt !== undefined &&
    (typeof createdAt !== "string" || !isCalendarDate(createdAt))
  ) {
    return inputFailure(
      "frontmatter.createdAt must be a YYYY-MM-DD date",
      yaml,
    );
  }

  const status = value.status;
  if (
    status !== undefined &&
    status !== "draft" &&
    status !== "final" &&
    status !== "archived"
  ) {
    return inputFailure(
      "frontmatter.status must be draft, final, or archived",
      yaml,
    );
  }

  const tags = value.tags;
  if (
    tags !== undefined &&
    (!Array.isArray(tags) ||
      tags.some((tag) => typeof tag !== "string" || tag.trim() === ""))
  ) {
    return inputFailure(
      "frontmatter.tags must be an array of non-empty strings",
      yaml,
    );
  }

  return {
    ok: true,
    value: {
      title,
      ...(summary.value === undefined ? {} : { summary: summary.value }),
      ...(author.value === undefined ? {} : { author: author.value }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(status === undefined ? {} : { status }),
      ...(tags === undefined ? {} : { tags }),
    },
  };
}

function optionalString(
  value: Record<string, unknown>,
  key: "summary" | "author",
  node: TreeNode | undefined,
): Result<string | undefined> {
  const candidate = value[key];
  if (candidate !== undefined && typeof candidate !== "string") {
    return inputFailure("frontmatter." + key + " must be a string", node);
  }
  return { ok: true, value: candidate };
}

function validateNode(
  node: TreeNode,
  parent: TreeNode | undefined,
  safeHtmlParent: TreeNode | undefined,
  sectionDepth: number,
  tabsDepth: number,
  timelineDepth: number,
  input: ReportInput,
  state: ValidationState,
): Result<void> {
  const mermaidIssue = validateMermaidNode(node, state.mermaid);
  if (mermaidIssue !== undefined) {
    return inputFailure(mermaidIssue.message, mermaidIssue.node);
  }
  if (node.type === "mdxjsEsm") {
    return inputFailure("import and export are not allowed", node);
  }
  if (
    node.type === "mdxFlowExpression" ||
    node.type === "mdxTextExpression"
  ) {
    return inputFailure("JavaScript expressions are not allowed", node);
  }
  if (node.type === "html") {
    return inputFailure("raw HTML is not allowed", node);
  }
  if (node.type === "heading") {
    const text = textContent(node);
    const slug = state.headingSlugger.slug(text);
    if (node.depth === 2 || node.depth === 3) {
      state.outline.push({
        depth: node.depth,
        text,
        slug,
      });
    }
  }
  if (node.type === "link") {
    const linkValidation = validateLink(node);
    if (!linkValidation.ok) {
      return linkValidation;
    }
  }
  if (node.type === "definition") {
    const referenceValidation = state.imageReferenceIdentifiers.has(
      node.identifier ?? "",
    )
      ? validateImage(node, input, state)
      : validateLink(node);
    if (!referenceValidation.ok) {
      return referenceValidation;
    }
  }
  if (node.type === "image") {
    const imageValidation = validateImage(node, input, state);
    if (!imageValidation.ok) {
      return imageValidation;
    }
  }

  let nextSectionDepth = sectionDepth;
  let nextTabsDepth = tabsDepth;
  let nextTimelineDepth = timelineDepth;
  if (
    node.type === "mdxJsxFlowElement" ||
    node.type === "mdxJsxTextElement"
  ) {
    if (node.name !== null && node.name !== undefined && node.name === node.name.toLowerCase()) {
      const htmlIssue = validateSafeHtmlElement(node, safeHtmlParent, state.htmlIds);
      if (htmlIssue !== undefined) {
        return inputFailure(htmlIssue.message, htmlIssue.node);
      }
      state.ariaReferences.push(...safeHtmlAriaReferences(node));
    } else {
      const componentIssue = validateComponent(node, {
        source: state.source,
        parent,
        sectionDepth,
        tabsDepth,
        timelineDepth,
        allocateId: (base) => allocateHtmlId(base, state.htmlIds),
        allocateTabsGroup: () => {
          state.tabsGroupCount += 1;
          return {
            name: "rpt-tabs-" + state.tabsGroupCount,
            index: state.tabsGroupCount,
          };
        },
        addOutline: (item) => state.outline.push(item),
        insert: (offset, text) => state.sourceInsertions.push({ offset, text }),
      });
      if (componentIssue !== undefined) {
        return inputFailure(componentIssue.message, componentIssue.node);
      }
      if (node.name === "Section") {
        nextSectionDepth += 1;
      }
      if (node.name === "Tabs") {
        nextTabsDepth += 1;
      }
      if (node.name === "Timeline") {
        nextTimelineDepth += 1;
      }
    }
  }

  const childSafeHtmlParent =
    node.name !== null && node.name !== undefined && node.name === node.name.toLowerCase()
      ? node
      : node.type === "paragraph"
        ? safeHtmlParent
        : undefined;

  for (const child of node.children ?? []) {
    const childParent =
      node.type === "paragraph" &&
      (parent?.name === "Tabs" || parent?.name === "Timeline")
        ? parent
        : node;
    const childValidation = validateNode(
      child,
      childParent,
      childSafeHtmlParent,
      nextSectionDepth,
      nextTabsDepth,
      nextTimelineDepth,
      input,
      state,
    );
    if (!childValidation.ok) {
      return childValidation;
    }
  }
  return { ok: true, value: undefined };
}

function validateLink(node: TreeNode): Result<void> {
  const url = node.url ?? "";
  if (isAllowedNavigationUrl(url)) {
    return { ok: true, value: undefined };
  }
  return inputFailure("link URL is not allowed", node);
}

function validateAriaReferences(state: ValidationState): Result<void> {
  for (const reference of state.ariaReferences) {
    if (!state.htmlIds.has(reference.target)) {
      return inputFailure(
        "ARIA reference must resolve to exactly one id: " + reference.target,
        reference.node,
      );
    }
  }
  return { ok: true, value: undefined };
}

function validateImage(
  node: TreeNode,
  input: ReportInput,
  state: ValidationState,
): Result<void> {
  const url = node.url ?? "";
  if (url.slice(0, 5).toLowerCase() === "data:") {
    const decoded = decodeRasterDataUrl(url);
    if (!decoded.ok) {
      return inputFailure(decoded.message, node);
    }
    state.decodedDataImageBytes += decoded.value.bytes.byteLength;
    if (state.decodedDataImageBytes > maximumTotalImageBytes) {
      return inputFailure("images exceed the 20 MiB total limit", node);
    }
    return { ok: true, value: undefined };
  }
  if (isAbsolute(url) || hasScheme(url) || url.startsWith("//")) {
    return inputFailure("remote images are not allowed", node);
  }

  const sourcePath = resolve(input.baseDirectory, url);
  const relativePath = relative(input.baseDirectory, sourcePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(".." + sep) ||
    isAbsolute(relativePath)
  ) {
    return inputFailure("image paths must stay within the input directory", node);
  }
  if (!state.assetPaths.has(sourcePath)) {
    state.assetPaths.add(sourcePath);
    state.assets.push({ sourcePath, relativePath });
  }
  return { ok: true, value: undefined };
}

function hasScheme(value: string): string | false {
  const match = /^[a-zA-Z][a-zA-Z\d+.-]*:/.exec(value);
  return match?.[0] ?? false;
}

function insertSource(
  source: string,
  insertions: readonly Readonly<{ offset: number; text: string }>[],
): string {
  return [...insertions]
    .sort((left, right) => right.offset - left.offset)
    .reduce(
      (result, insertion) =>
        result.slice(0, insertion.offset) +
        insertion.text +
        result.slice(insertion.offset),
      source,
    );
}

function textContent(node: TreeNode): string {
  if (node.type === "image") {
    return node.alt ?? "";
  }
  if (node.value !== undefined) {
    return node.value;
  }
  return (node.children ?? []).map(textContent).join("");
}

function collectMarkdownHeadingIds(node: TreeNode): Set<string> {
  const ids = new Set<string>();
  const slugger = new GithubSlugger();
  collectMarkdownHeadingIdsInto(node, ids, slugger);
  return ids;
}

function collectMarkdownHeadingIdsInto(
  node: TreeNode,
  ids: Set<string>,
  slugger: GithubSlugger,
): void {
  if (node.type === "heading") {
    ids.add(slugger.slug(textContent(node)));
  }
  for (const child of node.children ?? []) {
    collectMarkdownHeadingIdsInto(child, ids, slugger);
  }
}

function allocateHtmlId(base: string, ids: Set<string>): string {
  let candidate = base;
  let suffix = 1;
  while (ids.has(candidate)) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }
  ids.add(candidate);
  return candidate;
}

function collectImageReferenceIdentifiers(node: TreeNode): Set<string> {
  const identifiers = new Set<string>();
  collectImageReferenceIdentifiersInto(node, identifiers);
  return identifiers;
}

function collectImageReferenceIdentifiersInto(
  node: TreeNode,
  identifiers: Set<string>,
): void {
  if (node.type === "imageReference" && node.identifier !== undefined) {
    identifiers.add(node.identifier);
  }
  for (const child of node.children ?? []) {
    collectImageReferenceIdentifiersInto(child, identifiers);
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function locationOf(node: Positioned | undefined): Readonly<{
  line: number;
  column: number;
}> {
  return node?.position?.start ?? { line: 1, column: 1 };
}

function positionFromError(cause: unknown): Readonly<{
  line: number;
  column: number;
}> {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "line" in cause &&
    "column" in cause &&
    typeof cause.line === "number" &&
    typeof cause.column === "number"
  ) {
    return { line: cause.line, column: cause.column };
  }
  return { line: 1, column: 1 };
}

function inputFailure(
  message: string,
  node?: Positioned | Readonly<{ line: number; column: number }>,
  cause?: unknown,
): Result<never> {
  const location =
    node !== undefined && "line" in node
      ? node
      : locationOf(node);
  return {
    ok: false,
    error: {
      kind: "input",
      exitCode: 3,
      message,
      location,
      ...(cause === undefined ? {} : { cause }),
    },
  };
}
