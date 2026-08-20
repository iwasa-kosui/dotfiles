import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  ident,
  parse as parseCss,
  walk as walkCss,
  type CssNode,
} from "css-tree";
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from "parse5";
import { detectImageMimeType } from "./image.ts";
import type { FinalDomPolicy } from "./final-dom-policy.ts";
import { hoistRootDeclarations } from "./hoist-root-declarations.ts";
import { ariaIdReferenceAttributes } from "./safe-html.ts";
import { safeStyleViolation } from "./safe-style.ts";
import { isAllowedNavigationUrl } from "./safe-url.ts";
import type { Result } from "./result.ts";

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export async function inlineAssets(
  html: string,
  distDirectory: string,
  policy: FinalDomPolicy,
): Promise<Result<string>> {
  try {
    const realDistDirectory = await realpath(distDirectory);
    const document = parse(html, {
      scriptingEnabled: false,
      sourceCodeLocationInfo: true,
    });
    const processing = await processChildren(document, realDistDirectory, policy);
    if (!processing.ok) {
      return processing;
    }
    const validation = validateFinalDom(document, policy);
    if (!validation.ok) {
      return validation;
    }
    return { ok: true, value: serialize(document) };
  } catch (cause) {
    return buildFailure("could not inline report assets", cause);
  }
}

async function processChildren(
  parent: ParentNode,
  distDirectory: string,
  policy: FinalDomPolicy,
): Promise<Result<void>> {
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes[index];
    if (!("tagName" in child)) {
      continue;
    }
    const processing = await processElement(
      child,
      parent,
      index,
      distDirectory,
      policy,
    );
    if (!processing.ok) {
      return processing;
    }
  }
  return { ok: true, value: undefined };
}

async function processElement(
  element: Element,
  parent: ParentNode,
  index: number,
  distDirectory: string,
  policy: FinalDomPolicy,
): Promise<Result<void>> {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "script") {
    return isAllowedScript(element, policy)
      ? { ok: true, value: undefined }
      : unsafeHtml("report HTML contains a script outside the final DOM policy");
  }
  const style = attribute(element, "style");
  if (style !== undefined) {
    const violation = safeStyleViolation(style.value);
    if (violation !== undefined) {
      return unsafeHtml("report HTML contains unsafe style: " + violation);
    }
  }

  if (tagName === "link" && attribute(element, "href") !== undefined) {
    if (hasRel(element, "stylesheet")) {
      return inlineStylesheet(element, parent, index, distDirectory);
    }
    return unsafeHtml("report HTML contains a link asset reference");
  }

  if (tagName === "style") {
    const css = textContent(element);
    const validation = validateCss(css);
    if (!validation.ok) {
      return validation;
    }
    setTextContent(element, hoistRootDeclarations(css));
  }

  if (tagName === "img" || tagName === "source") {
    const src = attribute(element, "src");
    if (src !== undefined) {
      const inlined = await inlineImageUrl(src.value, distDirectory);
      if (!inlined.ok) {
        return inlined;
      }
      src.value = inlined.value;
    }
    const srcset = attribute(element, "srcset");
    if (srcset !== undefined) {
      const inlined = await inlineSrcset(srcset.value, distDirectory);
      if (!inlined.ok) {
        return inlined;
      }
      srcset.value = inlined.value;
    }
    if (!hasOnlyDataAssetReference(element, "src") || !hasDataSrcset(element)) {
      return unsafeHtml("report HTML contains a non-data image reference");
    }
  }

  if (
    (tagName === "video" && hasNonDataAttribute(element, ["src", "poster"])) ||
    (tagName === "audio" && hasNonDataAttribute(element, ["src"]))
  ) {
    return unsafeHtml("report HTML contains a non-data media reference");
  }
  if (
    (tagName === "iframe" && attribute(element, "src") !== undefined) ||
    (tagName === "embed" && attribute(element, "src") !== undefined) ||
    (tagName === "object" && attribute(element, "data") !== undefined)
  ) {
    return unsafeHtml("report HTML contains an embedded document reference");
  }
  if (
    tagName === "use" &&
    (attribute(element, "href") !== undefined ||
      attribute(element, "xlink:href") !== undefined)
  ) {
    return unsafeHtml("report HTML contains an SVG use reference");
  }

  const children = await processChildren(element, distDirectory, policy);
  if (!children.ok) {
    return children;
  }
  if (isTemplate(element)) {
    return processChildren(element.content, distDirectory, policy);
  }
  return { ok: true, value: undefined };
}

async function inlineStylesheet(
  element: Element,
  parent: ParentNode,
  index: number,
  distDirectory: string,
): Promise<Result<void>> {
  const href = attribute(element, "href");
  if (href === undefined) {
    return unsafeHtml("report HTML contains a stylesheet reference");
  }
  const stylesheet = await readLocalAsset(href.value, distDirectory);
  if (!stylesheet.ok) {
    return stylesheet;
  }
  const css = new TextDecoder().decode(stylesheet.value);
  if (/<\/style\b/i.test(css)) {
    return unsafeHtml("report stylesheet contains an HTML style terminator");
  }
  const validation = validateCss(css);
  if (!validation.ok) {
    return validation;
  }
  const fragment = parseFragment(`<style>${hoistRootDeclarations(css)}</style>`, {
    scriptingEnabled: false,
  });
  const style = fragment.childNodes[0];
  if (style === undefined || !("tagName" in style) || style.tagName !== "style") {
    return buildFailure("could not inline report stylesheet");
  }
  style.parentNode = parent;
  parent.childNodes[index] = style;
  return { ok: true, value: undefined };
}

async function inlineImageUrl(
  value: string,
  distDirectory: string,
): Promise<Result<string>> {
  if (isDataUrl(value)) {
    return { ok: true, value };
  }
  const bytes = await readLocalAsset(value, distDirectory);
  if (!bytes.ok) {
    return bytes;
  }
  const mimeType = detectImageMimeType(bytes.value);
  if (mimeType === undefined) {
    return unsafeHtml("report HTML references an unsupported image format");
  }
  return {
    ok: true,
    value: `data:${mimeType};base64,${Buffer.from(bytes.value).toString("base64")}`,
  };
}

async function inlineSrcset(
  value: string,
  distDirectory: string,
): Promise<Result<string>> {
  const candidates = parseSrcset(value);
  if (!candidates.ok) {
    return candidates;
  }
  const output: string[] = [];
  for (const candidate of candidates.value) {
    const url = await inlineImageUrl(candidate.url, distDirectory);
    if (!url.ok) {
      return url;
    }
    output.push(url.value + candidate.descriptor);
  }
  return { ok: true, value: output.join(", ") };
}

function parseSrcset(
  value: string,
): Result<readonly Readonly<{ url: string; descriptor: string }>[]> {
  const candidates: Array<Readonly<{ url: string; descriptor: string }>> = [];
  let offset = 0;
  while (offset < value.length) {
    while (
      offset < value.length &&
      (isAsciiWhitespace(value[offset] ?? "") || value[offset] === ",")
    ) {
      offset += 1;
    }
    if (offset >= value.length) {
      break;
    }
    const start = offset;
    while (
      offset < value.length &&
      !isAsciiWhitespace(value[offset] ?? "")
    ) {
      offset += 1;
    }
    let url = value.slice(start, offset);
    let trailingCommas = 0;
    while (url.endsWith(",")) {
      trailingCommas += 1;
      url = url.slice(0, -1);
    }
    if (url === "") {
      return unsafeHtml("report HTML contains an invalid srcset");
    }
    if (trailingCommas > 0) {
      candidates.push({ url, descriptor: "" });
      continue;
    }

    const descriptors: string[] = [];
    while (offset < value.length) {
      while (
        offset < value.length &&
        isAsciiWhitespace(value[offset] ?? "")
      ) {
        offset += 1;
      }
      if (offset >= value.length || value[offset] === ",") {
        offset += value[offset] === "," ? 1 : 0;
        break;
      }
      const descriptorStart = offset;
      let parentheses = 0;
      while (offset < value.length) {
        const character = value[offset] ?? "";
        if (character === "(") {
          parentheses += 1;
        } else if (character === ")" && parentheses > 0) {
          parentheses -= 1;
        } else if (
          parentheses === 0 &&
          (isAsciiWhitespace(character) || character === ",")
        ) {
          break;
        }
        offset += 1;
      }
      descriptors.push(value.slice(descriptorStart, offset));
    }
    if (!validSrcsetDescriptors(descriptors)) {
      return unsafeHtml("report HTML contains an invalid srcset");
    }
    const descriptor = descriptors.length === 0 ? "" : " " + descriptors.join(" ");
    candidates.push({ url, descriptor });
  }
  return candidates.length === 0
    ? unsafeHtml("report HTML contains an invalid srcset")
    : { ok: true, value: candidates };
}

function validSrcsetDescriptors(descriptors: readonly string[]): boolean {
  let width = false;
  let density = false;
  let height = false;
  for (const descriptor of descriptors) {
    if (/^[1-9]\d*w$/.test(descriptor) && !width && !density) {
      width = true;
    } else if (
      /^(?:\d+(?:\.\d*)?|\.\d+)x$/.test(descriptor) &&
      Number.parseFloat(descriptor) > 0 &&
      !width &&
      !density &&
      !height
    ) {
      density = true;
    } else if (/^[1-9]\d*h$/.test(descriptor) && !height && !density) {
      height = true;
    } else {
      return false;
    }
  }
  return !height || width;
}

function isAsciiWhitespace(value: string): boolean {
  return (
    value === "\t" ||
    value === "\n" ||
    value === "\f" ||
    value === "\r" ||
    value === " "
  );
}

async function readLocalAsset(
  reference: string,
  distDirectory: string,
): Promise<Result<Uint8Array>> {
  let url: URL;
  try {
    url = new URL(reference, "https://rpt.invalid/");
  } catch (cause) {
    return buildFailure("report HTML contains an invalid asset reference", cause);
  }
  if (
    url.origin !== "https://rpt.invalid" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return unsafeHtml("report HTML contains an external asset reference");
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (cause) {
    return buildFailure("report HTML contains an invalid asset path", cause);
  }
  const assetPath = resolve(distDirectory, "." + pathname);
  if (!isContained(distDirectory, assetPath)) {
    return unsafeHtml("report asset path escapes the build directory");
  }
  try {
    const realAssetPath = await realpath(assetPath);
    if (!isContained(distDirectory, realAssetPath)) {
      return unsafeHtml("report asset path escapes the build directory");
    }
    return { ok: true, value: await readFile(realAssetPath) };
  } catch (cause) {
    return buildFailure("could not read report asset", cause);
  }
}

function validateCss(css: string): Result<void> {
  return validateCssSyntax(css, "stylesheet");
}

function validateCssValue(css: string): Result<void> {
  return validateCssSyntax(css, "value");
}

function validateCssSyntax(
  css: string,
  context: "stylesheet" | "value",
): Result<void> {
  let violation: string | undefined;
  let assetFunctionDepth = 0;
  try {
    const ast = parseCss(css, {
      context,
      parseCustomProperty: true,
      onParseError(error) {
        throw error;
      },
    });
    walkCss(ast, {
      enter(node: CssNode) {
        if (
          node.type === "Atrule" &&
          ident.decode(node.name).toLowerCase() === "import"
        ) {
          violation = "report stylesheet contains @import";
          return;
        }
        if (node.type === "Url" && !isDataUrl(node.value)) {
          violation = "report stylesheet contains a non-data URL";
          return;
        }
        if (node.type === "Function") {
          const functionName = ident.decode(node.name).toLowerCase();
          if (
            assetFunctionDepth > 0 &&
            dynamicCssFunctions.has(functionName)
          ) {
            violation =
              "report stylesheet contains a dynamic asset reference";
          }
          if (functionName === "url") {
            const values = [...node.children].filter(
              (child) => child.type !== "WhiteSpace",
            );
            if (
              values.length !== 1 ||
              values[0]?.type !== "String" ||
              !isDataUrl(values[0].value)
            ) {
              violation = "report stylesheet contains a non-data URL";
            }
          }
          if (assetCssFunctions.has(functionName)) {
            assetFunctionDepth += 1;
          }
        }
        if (node.type === "Raw" && assetFunctionDepth > 0) {
          violation = "report stylesheet contains a dynamic asset reference";
        }
        if (
          node.type === "String" &&
          assetFunctionDepth > 0 &&
          !isDataUrl(node.value)
        ) {
          violation = "report stylesheet contains a non-data URL";
        }
      },
      leave(node: CssNode) {
        if (
          node.type === "Function" &&
          assetCssFunctions.has(ident.decode(node.name).toLowerCase())
        ) {
          assetFunctionDepth -= 1;
        }
      },
    });
  } catch (cause) {
    return unsafeHtml("report stylesheet contains invalid CSS", cause);
  }
  return violation === undefined
    ? { ok: true, value: undefined }
    : unsafeHtml(violation);
}

const assetCssFunctions = new Set([
  "url",
  "src",
  "image",
  "image-set",
  "-webkit-image-set",
]);

const dynamicCssFunctions = new Set(["attr", "env", "var"]);

const urlAttributeNames = new Set([
  "action",
  "archive",
  "attributionsrc",
  "background",
  "cite",
  "classid",
  "codebase",
  "data",
  "dynsrc",
  "formaction",
  "href",
  "imagesrcset",
  "longdesc",
  "lowsrc",
  "manifest",
  "ping",
  "poster",
  "profile",
  "src",
  "srcset",
  "usemap",
]);

const allowedDataAssetAttributes = new Map<string, ReadonlySet<string>>([
  ["audio", new Set(["src"])],
  ["feimage", new Set(["href"])],
  ["image", new Set(["href"])],
  ["img", new Set(["src"])],
  ["source", new Set(["src"])],
  ["track", new Set(["src"])],
  ["video", new Set(["poster", "src"])],
]);

const cssUrlAttributeNames = new Set([
  "clip-path",
  "color-profile",
  "cursor",
  "fill",
  "filter",
  "marker",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
]);

const activeElementNames = new Set([
  "applet",
  "base",
  "bgsound",
  "command",
  "embed",
  "fencedframe",
  "frame",
  "frameset",
  "iframe",
  "menuitem",
  "object",
  "portal",
  "script",
]);

const htmlNamespace = "http://www.w3.org/1999/xhtml";
const svgNamespace = "http://www.w3.org/2000/svg";
const svgDynamicElementNames = new Set([
  "animate",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "discard",
  "mpath",
  "set",
]);

function isAllowedScript(
  element: Element,
  policy: FinalDomPolicy,
): boolean {
  return (
    policy.kind === "mermaid" &&
    (isMermaidCdnScript(element, policy) ||
      isMermaidInitScript(element, policy))
  );
}

function isMermaidCdnScript(
  element: Element,
  policy: Extract<FinalDomPolicy, { kind: "mermaid" }>,
): boolean {
  return (
    element.namespaceURI === htmlNamespace &&
    hasExactAttributes(element, {
      src: policy.cdnUrl,
      nonce: policy.nonce,
    }) &&
    element.childNodes.length === 0
  );
}

function isMermaidInitScript(
  element: Element,
  policy: Extract<FinalDomPolicy, { kind: "mermaid" }>,
): boolean {
  return (
    element.namespaceURI === htmlNamespace &&
    hasExactAttributes(element, { nonce: policy.nonce }) &&
    element.childNodes.every((node) => node.nodeName === "#text") &&
    textContent(element) === policy.initScript
  );
}

function hasExactAttributes(
  element: Element,
  expected: Readonly<Record<string, string>>,
): boolean {
  const entries = Object.entries(expected);
  return (
    element.attrs.length === entries.length &&
    entries.every(
      ([name, value]) => attribute(element, name)?.value === value,
    )
  );
}

type FinalDomState = {
  readonly idCounts: Map<string, number>;
  readonly fragmentTargets: string[];
  readonly ariaTargets: string[];
  readonly scripts: Element[];
  readonly cspMetas: Array<
    Readonly<{ element: Element; parent: ParentNode }>
  >;
};

function validateFinalDom(
  parent: ParentNode,
  policy: FinalDomPolicy,
): Result<void> {
  const state: FinalDomState = {
    idCounts: new Map(),
    fragmentTargets: [],
    ariaTargets: [],
    scripts: [],
    cspMetas: [],
  };
  const validation = validateFinalDomInto(parent, state);
  if (!validation.ok) {
    return validation;
  }
  for (const [id, count] of state.idCounts) {
    if (count !== 1) {
      return unsafeHtml("report HTML contains duplicate id: " + id);
    }
  }
  for (const target of state.fragmentTargets) {
    if (state.idCounts.get(target) !== 1) {
      return unsafeHtml(
        "report HTML internal fragment must resolve to exactly one id: #" +
          target,
      );
    }
  }
  for (const target of state.ariaTargets) {
    if (state.idCounts.get(target) !== 1) {
      return unsafeHtml(
        "report HTML ARIA reference must resolve to exactly one id: " + target,
      );
    }
  }
  if (
    state.cspMetas.length !== 1 ||
    !isHtmlHead(state.cspMetas[0]!.parent) ||
    !hasExactAttributes(state.cspMetas[0]!.element, {
      "http-equiv": "Content-Security-Policy",
      content: policy.csp,
    })
  ) {
    return unsafeHtml(
      "report HTML must contain exactly one matching Content Security Policy meta",
    );
  }
  if (policy.kind === "static") {
    if (state.scripts.length !== 0) {
      return unsafeHtml("report HTML contains a script under the static policy");
    }
  } else if (
    state.scripts.length !== 2 ||
    !isMermaidCdnScript(state.scripts[0]!, policy) ||
    !isMermaidInitScript(state.scripts[1]!, policy)
  ) {
    return unsafeHtml(
      "report HTML scripts do not exactly match the Mermaid final DOM policy",
    );
  }
  return { ok: true, value: undefined };
}

function validateFinalDomInto(
  parent: ParentNode,
  state: FinalDomState,
): Result<void> {
  for (const child of parent.childNodes) {
    if (!("tagName" in child)) {
      continue;
    }
    const tagName = child.tagName.toLowerCase();
    if (
      child.namespaceURI === svgNamespace &&
      svgDynamicElementNames.has(tagName)
    ) {
      return unsafeHtml("report HTML contains dynamic SVG content");
    }
    if (tagName === "script") {
      state.scripts.push(child);
      continue;
    }
    if (activeElementNames.has(tagName)) {
      return unsafeHtml("report HTML contains an active element");
    }
    if (
      tagName === "meta" &&
      (attribute(child, "http-equiv")?.value ?? "").toLowerCase() ===
        "content-security-policy"
    ) {
      state.cspMetas.push({ element: child, parent });
    }
    if (
      tagName === "meta" &&
      (attribute(child, "http-equiv")?.value ?? "").toLowerCase() === "refresh"
    ) {
      return unsafeHtml("report HTML contains a meta refresh");
    }
    const id = attribute(child, "id")?.value;
    if (id !== undefined) {
      state.idCounts.set(id, (state.idCounts.get(id) ?? 0) + 1);
    }
    for (const candidate of child.attrs) {
      const name = candidate.name.toLowerCase();
      if (name === "style") {
        const violation = safeStyleViolation(candidate.value);
        if (violation !== undefined) {
          return unsafeHtml("report HTML contains unsafe style: " + violation);
        }
        continue;
      }
      if (name === "srcdoc" || name.startsWith("on")) {
        return unsafeHtml("report HTML contains an executable attribute");
      }
      const ariaReferenceKind = ariaIdReferenceAttributes.get(name);
      if (ariaReferenceKind !== undefined) {
        const targets = candidate.value.trim().split(/\s+/).filter(Boolean);
        if (targets.length === 0) {
          return unsafeHtml("report HTML ARIA reference must not be empty: " + name);
        }
        if (ariaReferenceKind === "single" && targets.length !== 1) {
          return unsafeHtml(
            "report HTML ARIA reference must name exactly one id: " + name,
          );
        }
        state.ariaTargets.push(...targets);
      }
      if (cssUrlAttributeNames.has(name)) {
        const cssValidation = validateCssValue(candidate.value);
        if (!cssValidation.ok) {
          return cssValidation;
        }
      }
      if (!urlAttributeNames.has(name)) {
        continue;
      }
      if (name === "srcset" || name === "imagesrcset") {
        const candidates = parseSrcset(candidate.value);
        if (
          (tagName !== "img" && tagName !== "source") ||
          !candidates.ok ||
          candidates.value.some((item) => !isDataUrl(item.url))
        ) {
          return unsafeHtml("report HTML contains an external asset reference");
        }
      } else if (
        (name === "href" && (tagName === "a" || tagName === "area")) ||
        (name === "cite" && (tagName === "blockquote" || tagName === "q"))
      ) {
        if (!isAllowedNavigationUrl(candidate.value)) {
          return unsafeHtml("report HTML contains an unsafe navigation URL");
        }
        const trimmed = candidate.value.trim();
        if (name === "href" && trimmed.startsWith("#")) {
          try {
            state.fragmentTargets.push(decodeURIComponent(trimmed.slice(1)));
          } catch (cause) {
            return unsafeHtml(
              "report HTML contains an invalid internal fragment",
              cause,
            );
          }
        }
      } else if (
        !allowedDataAssetAttributes.get(tagName)?.has(name) ||
        !isDataUrl(candidate.value)
      ) {
        return unsafeHtml("report HTML contains an external asset reference");
      }
    }
    const childValidation = validateFinalDomInto(child, state);
    if (!childValidation.ok) {
      return childValidation;
    }
    if (isTemplate(child)) {
      const templateValidation = validateFinalDomInto(child.content, state);
      if (!templateValidation.ok) {
        return templateValidation;
      }
    }
  }
  return { ok: true, value: undefined };
}

function attribute(element: Element, name: string) {
  return element.attrs.find((candidate) => candidate.name.toLowerCase() === name);
}

function hasRel(element: Element, token: string): boolean {
  return (attribute(element, "rel")?.value ?? "")
    .toLowerCase()
    .split(/\s+/)
    .includes(token);
}

function hasOnlyDataAssetReference(element: Element, name: string): boolean {
  const value = attribute(element, name)?.value;
  return value === undefined || isDataUrl(value);
}

function hasDataSrcset(element: Element): boolean {
  const value = attribute(element, "srcset")?.value;
  if (value === undefined) {
    return true;
  }
  const candidates = parseSrcset(value);
  return (
    candidates.ok &&
    candidates.value.every((candidate) => isDataUrl(candidate.url))
  );
}

function hasNonDataAttribute(element: Element, names: readonly string[]): boolean {
  return names.some((name) => {
    const value = attribute(element, name)?.value;
    return value !== undefined && !isDataUrl(value);
  });
}

function textContent(element: Element): string {
  return element.childNodes
    .filter(
      (node): node is DefaultTreeAdapterTypes.TextNode =>
        node.nodeName === "#text",
    )
    .map((node) => node.value)
    .join("");
}

function setTextContent(element: Element, value: string): void {
  element.childNodes = [
    { nodeName: "#text", value, parentNode: element } satisfies DefaultTreeAdapterTypes.TextNode,
  ];
}

function isTemplate(
  element: Element,
): element is DefaultTreeAdapterTypes.Template {
  return element.nodeName === "template";
}

function isHtmlHead(parent: ParentNode): boolean {
  return (
    "tagName" in parent &&
    parent.tagName.toLowerCase() === "head" &&
    parent.namespaceURI === htmlNamespace
  );
}

function isDataUrl(value: string): boolean {
  return value.trimStart().toLowerCase().startsWith("data:");
}

function isContained(base: string, candidate: string): boolean {
  const path = relative(base, candidate);
  return (
    path === "" ||
    (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path))
  );
}

function unsafeHtml(message: string, cause?: unknown): Result<never> {
  return buildFailure(message, cause);
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
