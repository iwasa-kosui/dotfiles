import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from "parse5";
import type { Result } from "./result.ts";

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export async function inlineAssets(
  html: string,
  distDirectory: string,
): Promise<Result<string>> {
  try {
    const realDistDirectory = await realpath(distDirectory);
    const document = parse(html, {
      scriptingEnabled: false,
      sourceCodeLocationInfo: true,
    });
    const processing = await processChildren(document, realDistDirectory);
    if (!processing.ok) {
      return processing;
    }
    return { ok: true, value: serialize(document) };
  } catch (cause) {
    return buildFailure("could not inline report assets", cause);
  }
}

export function detectImageMimeType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return "image/gif";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    const boxLength = Math.min(readBigEndianUint32(bytes, 0), bytes.byteLength);
    for (let offset = 8; offset + 4 <= boxLength; offset += 4) {
      const brand = ascii(bytes, offset, 4);
      if (brand === "avif" || brand === "avis") {
        return "image/avif";
      }
    }
  }
  return undefined;
}

async function processChildren(
  parent: ParentNode,
  distDirectory: string,
): Promise<Result<void>> {
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes[index];
    if (!("tagName" in child)) {
      continue;
    }
    const processing = await processElement(child, parent, index, distDirectory);
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
): Promise<Result<void>> {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "script") {
    return unsafeHtml("report HTML contains a script");
  }
  if (attribute(element, "style") !== undefined) {
    return unsafeHtml("report HTML contains a style attribute");
  }

  if (tagName === "link" && attribute(element, "href") !== undefined) {
    if (hasRel(element, "stylesheet")) {
      return inlineStylesheet(element, parent, index, distDirectory);
    }
    return unsafeHtml("report HTML contains a link asset reference");
  }

  if (tagName === "style") {
    const validation = validateCss(textContent(element));
    if (!validation.ok) {
      return validation;
    }
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

  const children = await processChildren(element, distDirectory);
  if (!children.ok) {
    return children;
  }
  if (isTemplate(element)) {
    return processChildren(element.content, distDirectory);
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
  const fragment = parseFragment(`<style>${css}</style>`, {
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
    while (offset < value.length && /[\s,]/.test(value[offset] ?? "")) {
      offset += 1;
    }
    if (offset >= value.length) {
      break;
    }
    const start = offset;
    if (value.slice(offset).toLowerCase().startsWith("data:")) {
      while (offset < value.length && !/\s/.test(value[offset] ?? "")) {
        offset += 1;
      }
    } else {
      while (offset < value.length && !/[\s,]/.test(value[offset] ?? "")) {
        offset += 1;
      }
    }
    const url = value.slice(start, offset);
    const descriptorStart = offset;
    while (offset < value.length && value[offset] !== ",") {
      offset += 1;
    }
    const descriptor = value.slice(descriptorStart, offset).trimEnd();
    if (url === "") {
      return unsafeHtml("report HTML contains an invalid srcset");
    }
    candidates.push({ url, descriptor });
    if (value[offset] === ",") {
      offset += 1;
    }
  }
  return candidates.length === 0
    ? unsafeHtml("report HTML contains an invalid srcset")
    : { ok: true, value: candidates };
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
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(withoutComments)) {
    return unsafeHtml("report stylesheet contains @import");
  }
  for (const match of withoutComments.matchAll(/url\s*\(\s*([^)]*?)\s*\)/gi)) {
    const rawValue = match[1]?.trim() ?? "";
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1).trim()
        : rawValue;
    if (!isDataUrl(value)) {
      return unsafeHtml("report stylesheet contains a non-data URL");
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

function isTemplate(
  element: Element,
): element is DefaultTreeAdapterTypes.Template {
  return element.nodeName === "template";
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

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.byteLength) {
    return "";
  }
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readBigEndianUint32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) {
    return 0;
  }
  return (
    (bytes[offset]! * 0x1000000) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function unsafeHtml(message: string): Result<never> {
  return buildFailure(message);
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
