import { isAbsolute, relative, resolve, sep } from "node:path";
import GithubSlugger from "github-slugger";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { parseDocument } from "yaml";
import type { ReportInput } from "./input.ts";
import type { Result } from "./result.ts";

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
}>;

type Point = Readonly<{
  line: number;
  column: number;
  offset?: number;
}>;

type Positioned = Readonly<{
  position?: Readonly<{ start: Point; end: Point }>;
}>;

type Attribute = Positioned &
  Readonly<{
    type: string;
    name?: string;
    value?: string | Positioned | null;
  }>;

type TreeNode = Positioned &
  Readonly<{
    type: string;
    value?: string;
    name?: string | null;
    url?: string;
    alt?: string | null;
    depth?: number;
    identifier?: string;
    attributes?: readonly Attribute[];
    children?: readonly TreeNode[];
  }>;

type ComponentRule = Readonly<{
  required: readonly string[];
  optional: readonly string[];
  tones?: readonly string[];
  children: boolean;
  topLevelOnly?: boolean;
  nested?: boolean;
  sourceProtocol?: "https:";
}>;

type ValidationState = {
  readonly source: string;
  readonly headingSlugger: GithubSlugger;
  readonly htmlIds: Set<string>;
  readonly outline: OutlineItem[];
  readonly assets: AssetReference[];
  readonly assetPaths: Set<string>;
  readonly imageReferenceIdentifiers: Set<string>;
  readonly anchorInsertions: Array<Readonly<{ offset: number; anchor: string }>>;
};

const componentRules: Readonly<Record<string, ComponentRule>> = {
  Callout: {
    required: ["tone"],
    optional: ["title"],
    tones: ["info", "success", "warning", "danger"],
    children: true,
  },
  Metric: {
    required: ["label", "value"],
    optional: [],
    children: false,
  },
  Evidence: {
    required: ["title", "source"],
    optional: [],
    children: true,
    sourceProtocol: "https:",
  },
  Section: {
    required: ["title"],
    optional: [],
    children: true,
    topLevelOnly: true,
    nested: false,
  },
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
    anchorInsertions: [],
  };
  const validation = validateNode(tree, undefined, 0, input, state);
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    value: {
      source: insertSectionAnchors(input.source, state.anchorInsertions),
      baseDirectory: input.baseDirectory,
      metadata: metadata.value,
      outline: state.outline,
      assets: state.assets,
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
  sectionDepth: number,
  input: ReportInput,
  state: ValidationState,
): Result<void> {
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
  if (
    node.type === "mdxJsxFlowElement" ||
    node.type === "mdxJsxTextElement"
  ) {
    const componentValidation = validateComponent(
      node,
      parent,
      sectionDepth,
      state,
    );
    if (!componentValidation.ok) {
      return componentValidation;
    }
    if (node.name === "Section") {
      nextSectionDepth += 1;
    }
  }

  for (const child of node.children ?? []) {
    const childValidation = validateNode(
      child,
      node,
      nextSectionDepth,
      input,
      state,
    );
    if (!childValidation.ok) {
      return childValidation;
    }
  }
  return { ok: true, value: undefined };
}

function validateComponent(
  node: TreeNode,
  parent: TreeNode | undefined,
  sectionDepth: number,
  state: ValidationState,
): Result<void> {
  const name = node.name;
  if (name === null || name === undefined) {
    return inputFailure("MDX fragments are not allowed", node);
  }
  if (name === name.toLowerCase()) {
    return inputFailure("raw HTML is not allowed", node);
  }

  const rule = componentRules[name];
  if (rule === undefined) {
    return inputFailure("component " + name + " is not allowed", node);
  }
  if (name === "Section" && isSelfClosing(node, state.source)) {
    return inputFailure("Section must not be self-closing", node);
  }
  if (
    rule.topLevelOnly &&
    (node.type !== "mdxJsxFlowElement" || parent?.type !== "root")
  ) {
    if (sectionDepth > 0) {
      return inputFailure("Section must not be nested", node);
    }
    return inputFailure("Section must be at the document top level", node);
  }
  if (rule.nested === false && sectionDepth > 0) {
    return inputFailure("Section must not be nested", node);
  }
  if (!rule.children && (node.children?.length ?? 0) > 0) {
    return inputFailure(name + " must not have children", node);
  }

  const values = new Map<string, string>();
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== "mdxJsxAttribute") {
      return inputFailure("dynamic component attributes are not allowed", attribute);
    }
    if (attribute.name === undefined || typeof attribute.value !== "string") {
      return inputFailure("dynamic component attributes are not allowed", attribute);
    }
    if (values.has(attribute.name)) {
      return inputFailure(
        "attribute " + attribute.name + " may only be specified once on " + name,
        attribute,
      );
    }
    if (
      attribute.name === "style" ||
      attribute.name === "class" ||
      attribute.name === "id" ||
      attribute.name === "anchor" ||
      attribute.name.startsWith("on") ||
      (!rule.required.includes(attribute.name) &&
        !rule.optional.includes(attribute.name))
    ) {
      return inputFailure(
        "attribute " + attribute.name + " is not allowed on " + name,
        attribute,
      );
    }
    values.set(attribute.name, attribute.value);
  }

  for (const required of rule.required) {
    if (!values.has(required)) {
      return inputFailure(name + "." + required + " is required", node);
    }
  }

  if (rule.tones !== undefined && !rule.tones.includes(values.get("tone") ?? "")) {
    return inputFailure(
      "Callout.tone must be info, success, warning, or danger",
      node,
    );
  }
  if (rule.sourceProtocol !== undefined) {
    const source = values.get("source") ?? "";
    try {
      if (new URL(source).protocol !== rule.sourceProtocol) {
        return inputFailure("Evidence.source must use https", node);
      }
    } catch {
      return inputFailure("Evidence.source must use https", node);
    }
  }

  if (name === "Section") {
    const title = values.get("title") ?? "";
    const anchor = allocateHtmlId(
      "section-" + new GithubSlugger().slug(title),
      state.htmlIds,
    );
    state.outline.push({ depth: 2, text: title, slug: anchor });
    const offset = openingTagEnd(node, state.source);
    if (offset === undefined) {
      return inputFailure("could not determine Section anchor position", node);
    }
    state.anchorInsertions.push({ offset, anchor });
  }

  return { ok: true, value: undefined };
}

function validateLink(node: TreeNode): Result<void> {
  const url = node.url ?? "";
  if (isAllowedLink(url)) {
    return { ok: true, value: undefined };
  }
  return inputFailure("link URL is not allowed", node);
}

function validateImage(
  node: TreeNode,
  input: ReportInput,
  state: ValidationState,
): Result<void> {
  const url = node.url ?? "";
  if (url.startsWith("data:")) {
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

function isAllowedLink(url: string): boolean {
  if (url.startsWith("#") || url.toLowerCase().startsWith("mailto:")) {
    return true;
  }
  if (url.startsWith("//")) {
    return false;
  }
  const scheme = hasScheme(url);
  return scheme === false || scheme.toLowerCase() === "https:";
}

function hasScheme(value: string): string | false {
  const match = /^[a-zA-Z][a-zA-Z\d+.-]*:/.exec(value);
  return match?.[0] ?? false;
}

function insertSectionAnchors(
  source: string,
  insertions: readonly Readonly<{ offset: number; anchor: string }>[],
): string {
  return [...insertions]
    .sort((left, right) => right.offset - left.offset)
    .reduce(
      (result, insertion) =>
        result.slice(0, insertion.offset) +
        " anchor=\"" +
        insertion.anchor +
        "\"" +
        result.slice(insertion.offset),
      source,
    );
}

function openingTagEnd(node: TreeNode, source: string): number | undefined {
  const position = node.position;
  if (
    position?.start.offset === undefined ||
    position.end.offset === undefined
  ) {
    return undefined;
  }

  let quote: "\"" | "'" | undefined;
  for (
    let index = position.start.offset;
    index < position.end.offset;
    index += 1
  ) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === quote && source[index - 1] !== "\\") {
        quote = undefined;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      return index;
    }
  }
  return undefined;
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

function isSelfClosing(node: TreeNode, source: string): boolean {
  const position = node.position;
  if (
    position?.start.offset === undefined ||
    position.end.offset === undefined
  ) {
    return false;
  }
  return source
    .slice(position.start.offset, position.end.offset)
    .trimEnd()
    .endsWith("/>");
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
