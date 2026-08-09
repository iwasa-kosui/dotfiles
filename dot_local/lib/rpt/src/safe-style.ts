import {
  generate as generateCss,
  parse as parseCss,
  walk as walkCss,
  type CssNode,
  type Declaration,
  type DeclarationList,
  type FunctionNode,
} from "css-tree";

const allowedProperties = new Set([
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "white-space",
  "overflow-wrap",
  "word-break",
  "vertical-align",
  "box-sizing",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "overflow-x",
  "overflow-y",
  "display",
  "gap",
  "row-gap",
  "column-gap",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "justify-content",
  "align-items",
  "align-content",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "place-items",
  "place-content",
  "border-collapse",
  "border-spacing",
  "table-layout",
  "list-style-type",
  "list-style-position",
]);

const allowedDisplayValues = new Set([
  "block",
  "inline",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "table",
  "table-row",
  "table-cell",
]);

const forbiddenFunctions = new Set([
  "image",
  "image-set",
  "element",
  "expression",
  "attr",
]);

export function safeStyleViolation(value: string): string | undefined {
  const declarations = parseDeclarationList(value);
  if (declarations === undefined) {
    return "style is invalid CSS";
  }

  const seenProperties = new Set<string>();
  for (const node of declarations.children) {
    if (node.type !== "Declaration") {
      return "style is invalid CSS";
    }

    const violation = declarationViolation(node, seenProperties);
    if (violation !== undefined) {
      return violation;
    }
  }

  let violation: string | undefined;
  walkCss(declarations, (node) => {
    if (violation !== undefined) {
      return;
    }
    if (node.type === "Url") {
      violation = "style URLs are not allowed";
      return;
    }
    if (node.type === "Function") {
      violation = functionViolation(node);
    }
  });
  return violation;
}

function parseDeclarationList(value: string): DeclarationList | undefined {
  try {
    const ast = parseCss(value, {
      context: "declarationList",
      parseCustomProperty: true,
      onParseError(error) {
        throw error;
      },
    });
    return ast.type === "DeclarationList" ? ast : undefined;
  } catch {
    return undefined;
  }
}

function declarationViolation(
  declaration: Declaration,
  seenProperties: Set<string>,
): string | undefined {
  const property = decodeCssIdentifier(declaration.property).toLowerCase();
  if (property.startsWith("--")) {
    return "custom style properties are not allowed";
  }
  if (!allowedProperties.has(property)) {
    return "style property " + property + " is not allowed";
  }
  if (seenProperties.has(property)) {
    return "style property " + property + " may only be specified once";
  }
  seenProperties.add(property);
  if (declaration.important) {
    return "style !important is not allowed";
  }
  if (property === "display") {
    const display = generateCss(declaration.value as CssNode).toLowerCase();
    if (!allowedDisplayValues.has(display)) {
      return "style display value " + display + " is not allowed";
    }
  }
  return undefined;
}

function functionViolation(node: FunctionNode): string | undefined {
  const name = node.name.toLowerCase();
  if (name === "var") {
    return isAllowedVariable(node) ? undefined : "style variable is not allowed";
  }
  if (forbiddenFunctions.has(name)) {
    return "style function " + name + " is not allowed";
  }
  return undefined;
}

function isAllowedVariable(node: FunctionNode): boolean {
  const arguments_ = node.children.toArray();
  return (
    arguments_.length === 1 &&
    arguments_[0]?.type === "Identifier" &&
    arguments_[0].name.startsWith("--w-")
  );
}

function decodeCssIdentifier(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})[\t\n\f\r ]?|([^\n\r\f0-9a-f]))/gi,
    (_match, codePoint: string | undefined, character: string | undefined) => {
      if (codePoint === undefined) {
        return character ?? "";
      }
      const value = Number.parseInt(codePoint, 16);
      return value === 0 || value > 0x10ffff
        ? "\uFFFD"
        : String.fromCodePoint(value);
    },
  );
}
