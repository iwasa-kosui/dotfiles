import GithubSlugger from "github-slugger";
import type {
  Attribute,
  TreeNode,
  ValidationIssue,
} from "./validation-types.ts";

export type ComponentContext = Readonly<{
  source: string;
  parent?: TreeNode;
  sectionDepth: number;
  tabsDepth: number;
  timelineDepth: number;
  allocateId(base: string): string;
  allocateTabsGroup(): Readonly<{ name: string; index: number }>;
  addOutline(item: Readonly<{ depth: 2 | 3; text: string; slug: string }>): void;
  insert(offset: number, text: string): void;
}>;

type ComponentRule = Readonly<{
  required: readonly string[];
  optional: readonly string[];
  children: boolean;
}>;

const tones = ["neutral", "info", "success", "warning", "danger"] as const;
const calloutTones = ["info", "success", "warning", "danger"] as const;
const inlineHtmlElementNames = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "cite",
  "code",
  "data",
  "em",
  "i",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);
const iconNames = [
  "alert",
  "check",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "chevron-up",
  "circle-check",
  "circle-close",
  "close",
  "copy",
  "github",
  "home",
  "info",
  "minus",
  "moon",
  "order",
  "plus",
  "search",
  "sun",
  "warning",
] as const;

const componentRules: Readonly<Record<string, ComponentRule>> = {
  Callout: { required: ["tone"], optional: ["title"], children: true },
  Metric: { required: ["label", "value"], optional: [], children: false },
  Evidence: { required: ["title", "source"], optional: [], children: true },
  Section: { required: ["title"], optional: [], children: true },
  Badge: { required: ["tone"], optional: [], children: true },
  Status: { required: ["tone"], optional: [], children: true },
  Icon: { required: ["name"], optional: ["label", "size"], children: false },
  Timeline: { required: [], optional: ["theme"], children: true },
  TimelineItem: { required: [], optional: ["title", "icon"], children: true },
  Tabs: { required: [], optional: [], children: true },
  Tab: { required: ["label"], optional: ["active"], children: true },
};

export function validateComponent(
  node: TreeNode,
  context: ComponentContext,
): ValidationIssue | undefined {
  const name = node.name;
  if (name === null || name === undefined) {
    return issue("MDX fragments are not allowed", node);
  }
  if (name === name.toLowerCase()) {
    return issue("raw HTML is not allowed", node);
  }

  const rule = componentRules[name];
  if (rule === undefined) {
    return issue("component " + name + " is not allowed", node);
  }
  const values = readAttributes(node, name, rule);
  if (values instanceof Error) {
    return issue(values.message, values.node);
  }
  for (const required of rule.required) {
    if (!values.has(required)) {
      return issue(name + "." + required + " is required", node);
    }
  }
  if (!rule.children && (node.children?.length ?? 0) > 0) {
    return issue(name + " must not have children", node);
  }

  switch (name) {
    case "Callout":
      return validateTone(name, values, calloutTones, node);
    case "Evidence":
      return validateEvidence(values, node);
    case "Section":
      return validateSection(node, values, context);
    case "Badge":
    case "Status":
      return validateInlineToneComponent(name, node, values);
    case "Icon":
      return validateIcon(node, values, context);
    case "Timeline":
      return validateTimeline(node, values, context);
    case "TimelineItem":
      return validateTimelineItem(node, values, context);
    case "Tabs":
      return validateTabs(node, context);
    case "Tab":
      return validateTab(node, values, context);
  }
}

type AttributeValues = Map<string, string>;

class AttributeError extends Error {
  constructor(
    message: string,
    readonly node: Attribute,
  ) {
    super(message);
  }
}

function readAttributes(
  node: TreeNode,
  name: string,
  rule: ComponentRule,
): AttributeValues | AttributeError {
  const values: AttributeValues = new Map();
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== "mdxJsxAttribute") {
      return new AttributeError(
        "dynamic component attributes are not allowed",
        attribute,
      );
    }
    if (attribute.name === undefined || typeof attribute.value !== "string") {
      return new AttributeError(
        "dynamic component attributes are not allowed",
        attribute,
      );
    }
    if (values.has(attribute.name)) {
      return new AttributeError(
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
      return new AttributeError(
        "attribute " + attribute.name + " is not allowed on " + name,
        attribute,
      );
    }
    values.set(attribute.name, attribute.value);
  }
  return values;
}

function validateTone(
  name: "Callout" | "Badge" | "Status",
  values: AttributeValues,
  allowedTones: readonly string[],
  node: TreeNode,
): ValidationIssue | undefined {
  if (!allowedTones.includes(values.get("tone") ?? "")) {
    return issue(
      name + ".tone must be " + joinChoices(allowedTones),
      node,
    );
  }
}

function validateEvidence(
  values: AttributeValues,
  node: TreeNode,
): ValidationIssue | undefined {
  try {
    if (new URL(values.get("source") ?? "").protocol !== "https:") {
      return issue("Evidence.source must use https", node);
    }
  } catch {
    return issue("Evidence.source must use https", node);
  }
}

function validateSection(
  node: TreeNode,
  values: AttributeValues,
  context: ComponentContext,
): ValidationIssue | undefined {
  if (isSelfClosing(node, context.source)) {
    return issue("Section must not be self-closing", node);
  }
  if (node.type !== "mdxJsxFlowElement" || context.parent?.type !== "root") {
    if (context.sectionDepth > 0) {
      return issue("Section must not be nested", node);
    }
    return issue("Section must be at the document top level", node);
  }
  if (context.sectionDepth > 0) {
    return issue("Section must not be nested", node);
  }

  const title = values.get("title") ?? "";
  const anchor = context.allocateId("section-" + new GithubSlugger().slug(title));
  const offset = openingTagInsertionOffset(node, context.source);
  if (offset === undefined) {
    return issue("could not determine Section anchor position", node);
  }
  context.addOutline({ depth: 2, text: title, slug: anchor });
  context.insert(offset, " anchor=\"" + anchor + "\"");
}

function validateInlineToneComponent(
  name: "Badge" | "Status",
  node: TreeNode,
  values: AttributeValues,
): ValidationIssue | undefined {
  const toneValidation = validateTone(name, values, tones, node);
  if (toneValidation !== undefined) {
    return toneValidation;
  }
  const children = node.children ?? [];
  if (
    children.length === 0 ||
    children.some((child) => !isInlineContentNode(child)) ||
    textContent(node).trim() === ""
  ) {
    return issue(name + " must contain inline content", node);
  }
}

function validateIcon(
  node: TreeNode,
  values: AttributeValues,
  context: ComponentContext,
): ValidationIssue | undefined {
  if (!isSelfClosing(node, context.source)) {
    return issue("Icon must be self-closing", node);
  }
  const name = values.get("name") ?? "";
  if (!iconNames.includes(name as (typeof iconNames)[number])) {
    return issue("Icon.name must be one of: " + iconNames.join(", "), node);
  }
  const label = values.get("label");
  if (label !== undefined && label.trim() === "") {
    return issue("Icon.label must be a non-empty string", node);
  }
  const size = values.get("size");
  if (size !== undefined && !["16", "20", "24", "32"].includes(size)) {
    return issue("Icon.size must be 16, 20, 24, or 32", node);
  }
}

function validateTimeline(
  node: TreeNode,
  values: AttributeValues,
  context: ComponentContext,
): ValidationIssue | undefined {
  if (context.timelineDepth > 0) {
    return issue("Timeline must not be nested", node);
  }
  const theme = values.get("theme") ?? "default";
  if (!["default", "fill", "stroke", "icons"].includes(theme)) {
    return issue("Timeline.theme must be default, fill, stroke, or icons", node);
  }
  const children = containerChildren(node);
  if (
    children.length < 2 ||
    children.some((child) => !isNamedComponent(child, "TimelineItem"))
  ) {
    return issue("Timeline may only contain TimelineItem children", node);
  }
  if (
    theme === "icons" &&
    children.some((child) => attributeValue(child, "icon") === undefined)
  ) {
    return issue("Timeline theme icons requires every TimelineItem.icon", node);
  }
}

function validateTimelineItem(
  node: TreeNode,
  values: AttributeValues,
  context: ComponentContext,
): ValidationIssue | undefined {
  if (!isNamedComponent(context.parent, "Timeline")) {
    return issue("TimelineItem must be a direct child of Timeline", node);
  }
  const title = values.get("title");
  if (title !== undefined && title.trim() === "") {
    return issue("TimelineItem.title must be a non-empty string", node);
  }
  const icon = values.get("icon");
  if (icon !== undefined && !iconNames.includes(icon as (typeof iconNames)[number])) {
    return issue("TimelineItem.icon must be one of: " + iconNames.join(", "), node);
  }
  const theme = attributeValue(context.parent, "theme") ?? "default";
  if (theme === "icons" && icon === undefined) {
    return issue("Timeline theme icons requires every TimelineItem.icon", node);
  }
  if (theme !== "icons" && icon !== undefined) {
    return issue("TimelineItem.icon is only allowed when Timeline.theme is icons", node);
  }
}

function validateTabs(
  node: TreeNode,
  context: ComponentContext,
): ValidationIssue | undefined {
  if (context.tabsDepth > 0) {
    return issue("Tabs must not be nested", node);
  }
  const children = containerChildren(node);
  if (
    children.length < 2 ||
    children.length > 10 ||
    children.some((child) => !isNamedComponent(child, "Tab"))
  ) {
    return issue("Tabs must contain between 2 and 10 Tab children", node);
  }
  const activeTabs = children.filter(
    (child) => attributeValue(child, "active") === "true",
  );
  if (activeTabs.length > 1) {
    return issue("Tabs may only contain one active Tab", node);
  }

  const group = context.allocateTabsGroup();
  for (const [index, child] of children.entries()) {
    const offset = openingTagInsertionOffset(child, context.source);
    if (offset === undefined) {
      return issue("could not determine Tab props position", child);
    }
    const tabIndex = index + 1;
    const checked =
      activeTabs.length === 0 ? index === 0 : attributeValue(child, "active") === "true";
    const controlId = context.allocateId(
      "rpt-tab-control-" + group.index + "-" + tabIndex,
    );
    const labelId = context.allocateId(
      "rpt-tab-label-" + group.index + "-" + tabIndex,
    );
    const panelId = context.allocateId(
      "rpt-tab-panel-" + group.index + "-" + tabIndex,
    );
    context.insert(
      offset,
      " group=\"" +
        group.name +
        "\" controlId=\"" +
        controlId +
        "\" labelId=\"" +
        labelId +
        "\" panelId=\"" +
        panelId +
        "\" checked=\"" +
        checked +
        "\"",
    );
  }
}

function validateTab(
  node: TreeNode,
  values: AttributeValues,
  context: ComponentContext,
): ValidationIssue | undefined {
  if (!isNamedComponent(context.parent, "Tabs")) {
    return issue("Tab must be a direct child of Tabs", node);
  }
  if ((values.get("label") ?? "").trim() === "") {
    return issue("Tab.label must be a non-empty string", node);
  }
  const active = values.get("active");
  if (active !== undefined && active !== "true") {
    return issue("Tab.active must be true", node);
  }
}

function nonWhitespaceChildren(node: TreeNode): readonly TreeNode[] {
  return (node.children ?? []).filter(
    (child) => child.type !== "text" || (child.value ?? "").trim() !== "",
  );
}

function containerChildren(node: TreeNode): readonly TreeNode[] {
  return nonWhitespaceChildren(node).flatMap((child) =>
    child.type === "paragraph" ? nonWhitespaceChildren(child) : [child],
  );
}

function isInlineContentNode(node: TreeNode): boolean {
  const isInlineMarkdown = [
    "text",
    "emphasis",
    "strong",
    "delete",
    "inlineCode",
    "link",
    "linkReference",
    "image",
    "imageReference",
    "break",
    "footnoteReference",
  ].includes(node.type);
  const isAllowedMdxElement =
    node.type === "mdxJsxTextElement" &&
    typeof node.name === "string" &&
    (node.name === "Icon" || inlineHtmlElementNames.has(node.name));
  if (!isInlineMarkdown && !isAllowedMdxElement) {
    return false;
  }
  return (node.children ?? []).every(isInlineContentNode);
}

function isNamedComponent(
  node: TreeNode | undefined,
  name: string,
): node is TreeNode {
  return (
    node !== undefined &&
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
    node.name === name
  );
}

function attributeValue(node: TreeNode, name: string): string | undefined {
  const attribute = node.attributes?.find(
    (candidate) =>
      candidate.type === "mdxJsxAttribute" &&
      candidate.name === name &&
      typeof candidate.value === "string",
  );
  return typeof attribute?.value === "string" ? attribute.value : undefined;
}

function openingTagInsertionOffset(
  node: TreeNode,
  source: string,
): number | undefined {
  const position = node.position;
  if (
    position?.start.offset === undefined ||
    position.end.offset === undefined
  ) {
    return undefined;
  }

  let quote: "\"" | "'" | undefined;
  for (let index = position.start.offset; index < position.end.offset; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === quote && !hasOddPrecedingBackslashes(source, index)) {
        quote = undefined;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      let insertionOffset = index;
      while (source[insertionOffset - 1] === " " || source[insertionOffset - 1] === "\n") {
        insertionOffset -= 1;
      }
      return source[insertionOffset - 1] === "/" ? insertionOffset - 1 : index;
    }
  }
  return undefined;
}

function hasOddPrecedingBackslashes(source: string, offset: number): boolean {
  let count = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function isSelfClosing(node: TreeNode, source: string): boolean {
  const position = node.position;
  return (
    position?.start.offset !== undefined &&
    position.end.offset !== undefined &&
    source.slice(position.start.offset, position.end.offset).trimEnd().endsWith("/>")
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

function joinChoices(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return values[0] + " or " + values[1];
  }
  return values.slice(0, -1).join(", ") + ", or " + values.at(-1);
}

function issue(message: string, node: TreeNode | Attribute): ValidationIssue {
  return { message, node };
}
