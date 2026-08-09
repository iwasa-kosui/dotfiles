import { safeStyleViolation } from "./safe-style.ts";
import { isAllowedNavigationUrl } from "./safe-url.ts";
import type { Attribute, TreeNode, ValidationIssue } from "./validation-types.ts";

const allowedElements = new Set([
  "article", "section", "aside", "header", "footer", "div", "span",
  "p", "br", "hr", "blockquote", "q", "cite", "abbr", "pre", "code",
  "kbd", "samp", "var", "mark", "strong", "em", "b", "i", "u", "s",
  "small", "sub", "sup", "ul", "ol", "li", "dl", "dt", "dd", "table",
  "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup",
  "col", "details", "summary", "figure", "figcaption", "time", "data", "a",
]);

const allowedRoles = new Set([
  "article", "complementary", "contentinfo", "definition", "document", "figure",
  "group", "list", "listitem", "none", "note", "presentation", "region", "status",
  "table", "row", "rowgroup", "columnheader", "rowheader", "cell",
]);

const allowedGlobalAttributes = new Set(["id", "role", "title", "lang", "dir", "style"]);

const allowedElementAttributes: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(["href", "rel"]),
  blockquote: new Set(["cite"]),
  q: new Set(["cite"]),
  details: new Set(["open"]),
  ol: new Set(["start", "reversed", "type"]),
  li: new Set(["value"]),
  time: new Set(["datetime"]),
  data: new Set(["value"]),
  th: new Set(["colspan", "rowspan", "headers", "scope", "abbr"]),
  td: new Set(["colspan", "rowspan", "headers"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
};

export const ariaIdReferenceAttributes = new Map<string, "single" | "multiple">([
  ["aria-labelledby", "multiple"],
  ["aria-describedby", "multiple"],
  ["aria-details", "single"],
  ["aria-controls", "multiple"],
  ["aria-owns", "multiple"],
  ["aria-flowto", "multiple"],
  ["aria-activedescendant", "single"],
  ["aria-errormessage", "single"],
]);

export type AriaIdReference = Readonly<{
  target: string;
  node: Attribute;
}>;

export function validateSafeHtmlElement(
  node: TreeNode,
  parent: TreeNode | undefined,
  ids: Set<string>,
): ValidationIssue | undefined {
  const name = node.name;
  if (name === null || name === undefined || !allowedElements.has(name)) {
    return issue("element " + (name ?? "fragment") + " is not allowed", node);
  }

  const childIssue = validateParent(name, node, parent);
  if (childIssue !== undefined) {
    return childIssue;
  }
  const childrenIssue = validateChildren(name, node);
  if (childrenIssue !== undefined) {
    return childrenIssue;
  }

  const attributes = new Set<string>();
  for (const attribute of node.attributes ?? []) {
    const attributeIssue = validateAttribute(name, attribute, attributes, ids);
    if (attributeIssue !== undefined) {
      return attributeIssue;
    }
  }
  return undefined;
}

function validateAttribute(
  element: string,
  attribute: Attribute,
  attributes: Set<string>,
  ids: Set<string>,
): ValidationIssue | undefined {
  if (
    attribute.type !== "mdxJsxAttribute" ||
    attribute.name === undefined ||
    typeof attribute.value !== "string"
  ) {
    return issue("dynamic HTML attributes are not allowed", attribute);
  }
  const name = attribute.name;
  if (attributes.has(name)) {
    return issue("attribute " + name + " may only be specified once on " + element, attribute);
  }
  attributes.add(name);
  const allowed =
    allowedGlobalAttributes.has(name) ||
    name.startsWith("aria-") ||
    allowedElementAttributes[element]?.has(name) === true;
  if (!allowed || name.startsWith("on")) {
    return issue("attribute " + name + " is not allowed on " + element, attribute);
  }

  const value = attribute.value;
  if (name === "id") {
    if (value === "") {
      return issue("id must not be empty", attribute);
    }
    if (value.startsWith("rpt-")) {
      return issue("id prefix rpt- is reserved", attribute);
    }
    if (ids.has(value)) {
      return issue("id may only be specified once", attribute);
    }
    ids.add(value);
  }
  if (name === "role" && !allowedRoles.has(value)) {
    return issue("role " + value + " is not allowed", attribute);
  }
  if (name === "dir" && value !== "ltr" && value !== "rtl" && value !== "auto") {
    return issue("dir must be ltr, rtl, or auto", attribute);
  }
  if (name === "style") {
    const violation = safeStyleViolation(value);
    if (violation !== undefined) {
      return issue(violation, attribute);
    }
  }
  const referenceKind = ariaIdReferenceAttributes.get(name);
  if (referenceKind !== undefined) {
    const targets = value.trim().split(/\s+/).filter(Boolean);
    if (targets.length === 0) {
      return issue("ARIA reference " + name + " must not be empty", attribute);
    }
    if (referenceKind === "single" && targets.length !== 1) {
      return issue("ARIA reference " + name + " must name exactly one id", attribute);
    }
  }
  if ((name === "href" || name === "cite") && !isAllowedNavigationUrl(value)) {
    return issue(name + " URL is not allowed", attribute);
  }
  if (name === "rel" && value.split(/\s+/).some((token) => token !== "noreferrer" && token !== "noopener")) {
    return issue("rel may only contain noreferrer and noopener", attribute);
  }
  return undefined;
}

function validateParent(
  name: string,
  node: TreeNode,
  parent: TreeNode | undefined,
): ValidationIssue | undefined {
  const parentName = parent?.name;
  if ((name === "li" && parentName !== "ul" && parentName !== "ol") ||
      ((name === "dt" || name === "dd") && parentName !== "dl")) {
    return issue(name + " must be a direct child of its list", node);
  }
  if ((parentName === "ul" || parentName === "ol") && name !== "li") {
    return issue(parentName + " may only contain li elements", node);
  }
  if (name === "summary") {
    if (parentName !== "details") {
      return issue("summary must be a direct child of details", node);
    }
    const firstElement = firstHtmlChild(parent);
    if (firstElement !== node) {
      return issue("summary must be the first element in details", node);
    }
  }
  if (
    parentName === "table" &&
    name !== "caption" &&
    name !== "colgroup" &&
    name !== "thead" &&
    name !== "tbody" &&
    name !== "tfoot"
  ) {
    return issue(
      "table may only contain caption, colgroup, thead, tbody, and tfoot elements",
      node,
    );
  }
  if ((name === "caption" || name === "colgroup" || name === "thead" || name === "tbody" || name === "tfoot") && parentName !== "table") {
    return issue(name + " must be a direct child of table", node);
  }
  if (name === "col" && parentName !== "colgroup") {
    return issue("col must be a direct child of colgroup", node);
  }
  if (name === "tr" && parentName !== "thead" && parentName !== "tbody" && parentName !== "tfoot") {
    return issue("tr must be a direct child of a table section", node);
  }
  if ((name === "th" || name === "td") && parentName !== "tr") {
    return issue(name + " must be a direct child of tr", node);
  }
  if (parentName === "colgroup" && name !== "col") {
    return issue("colgroup may only contain col elements", node);
  }
  if ((parentName === "thead" || parentName === "tbody" || parentName === "tfoot") && name !== "tr") {
    return issue(parentName + " may only contain tr elements", node);
  }
  if (parentName === "tr" && name !== "th" && name !== "td") {
    return issue("tr may only contain th and td elements", node);
  }
  return undefined;
}

function validateChildren(name: string, node: TreeNode): ValidationIssue | undefined {
  const allowedChildren =
    name === "ul" || name === "ol"
      ? new Set(["li"])
      : name === "dl"
        ? new Set(["dt", "dd"])
      : name === "table"
        ? new Set(["caption", "colgroup", "thead", "tbody", "tfoot"])
        : name === "colgroup"
          ? new Set(["col"])
          : name === "thead" || name === "tbody" || name === "tfoot"
            ? new Set(["tr"])
            : name === "tr"
              ? new Set(["th", "td"])
              : undefined;
  if (allowedChildren !== undefined && !hasOnlyElementChildren(node, allowedChildren)) {
    if (name === "ul" || name === "ol") {
      return issue(name + " may only contain li elements", node);
    }
    if (name === "dl") {
      return issue("dl may only contain dt and dd elements", node);
    }
    if (name === "table") {
      return issue(
        "table may only contain caption, colgroup, thead, tbody, and tfoot elements",
        node,
      );
    }
    return issue(name + " contains an invalid child element", node);
  }
  if (name === "table" && !hasValidTableOrder(node)) {
    return issue("table elements are in an invalid order", node);
  }
  if (name === "dl" && !hasValidDescriptionListOrder(node)) {
    return issue("dl elements are in an invalid order", node);
  }
  return undefined;
}

function hasOnlyElementChildren(node: TreeNode, allowed: ReadonlySet<string>): boolean {
  return flattenedChildren(node).every((child) =>
    child.type === "text"
      ? (child.value ?? "").trim() === ""
      : child.name !== null && child.name !== undefined && allowed.has(child.name),
  );
}

function hasValidTableOrder(node: TreeNode): boolean {
  const children = flattenedChildren(node).filter(
    (child) => child.name !== null && child.name !== undefined,
  );
  const names = children.map((child) => child.name!);
  const caption = names.indexOf("caption");
  if (caption > 0 || names.filter((name) => name === "caption").length > 1) {
    return false;
  }
  const thead = names.indexOf("thead");
  const tfoot = names.indexOf("tfoot");
  if (
    names.filter((name) => name === "thead").length > 1 ||
    names.filter((name) => name === "tfoot").length > 1 ||
    (thead !== -1 && names.slice(0, thead).some((name) => name === "tbody" || name === "tfoot")) ||
    (tfoot !== -1 && names.slice(tfoot + 1).some((name) => name === "thead" || name === "tbody"))
  ) {
    return false;
  }
  const firstSection = names.findIndex((name) => name === "thead" || name === "tbody" || name === "tfoot");
  return firstSection === -1 || names.slice(firstSection).every((name) => name !== "colgroup");
}

function hasValidDescriptionListOrder(node: TreeNode): boolean {
  let hasTerm = false;
  let hasDefinition = false;
  for (const child of flattenedChildren(node)) {
    if (child.name === "dt") {
      if (hasDefinition) {
        hasTerm = false;
        hasDefinition = false;
      }
      hasTerm = true;
    } else if (child.name === "dd") {
      if (!hasTerm) {
        return false;
      }
      hasDefinition = true;
    }
  }
  return hasTerm && hasDefinition;
}

function flattenedChildren(node: TreeNode): readonly TreeNode[] {
  return (node.children ?? []).flatMap((child) =>
    child.type === "paragraph" ? flattenedChildren(child) : [child],
  );
}

function issue(message: string, node: Attribute | TreeNode): ValidationIssue {
  return { message, node };
}

export function safeHtmlAriaReferences(node: TreeNode): readonly AriaIdReference[] {
  return (node.attributes ?? []).flatMap((attribute) => {
    if (
      attribute.type !== "mdxJsxAttribute" ||
      attribute.name === undefined ||
      typeof attribute.value !== "string" ||
      !ariaIdReferenceAttributes.has(attribute.name)
    ) {
      return [];
    }
    return attribute.value.trim().split(/\s+/).filter(Boolean).map((target) => ({
      target,
      node: attribute,
    }));
  });
}

function firstHtmlChild(parent: TreeNode | undefined): TreeNode | undefined {
  for (const child of parent?.children ?? []) {
    if (child.type === "text" && (child.value ?? "").trim() !== "") {
      return child;
    }
    if (child.name !== null && child.name !== undefined) {
      return child;
    }
    if (child.type === "paragraph") {
      for (const paragraphChild of child.children ?? []) {
        if (paragraphChild.type === "text" && (paragraphChild.value ?? "").trim() === "") {
          continue;
        }
        if (paragraphChild.name !== null && paragraphChild.name !== undefined) {
          return paragraphChild;
        }
        return child;
      }
    }
  }
  return undefined;
}
