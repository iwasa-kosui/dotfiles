import { maximumImageBytes } from "./limits.ts";

export type DecodedRasterDataUrl =
  | Readonly<{
      ok: true;
      value: Readonly<{ mimeType: string; bytes: Uint8Array }>;
    }>
  | Readonly<{ ok: false; message: string }>;

const allowedRasterMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function decodeRasterDataUrl(value: string): DecodedRasterDataUrl {
  const comma = value.indexOf(",");
  if (comma < 5) {
    return { ok: false, message: "data URL image contains invalid base64" };
  }
  const mediaTypeParts = value.slice(5, comma).split(";");
  const mimeType = (mediaTypeParts[0] ?? "").toLowerCase();
  if (!allowedRasterMimeTypes.has(mimeType)) {
    return { ok: false, message: "data URL image MIME type is not allowed" };
  }
  if (
    mediaTypeParts.length !== 2 ||
    mediaTypeParts[1]?.toLowerCase() !== "base64"
  ) {
    return { ok: false, message: "data URL images must use base64" };
  }

  const payload = value.slice(comma + 1);
  if (!isStrictBase64(payload)) {
    return { ok: false, message: "data URL image contains invalid base64" };
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const decodedByteLength = (payload.length / 4) * 3 - padding;
  if (decodedByteLength > maximumImageBytes) {
    return { ok: false, message: "data URL image exceeds the 5 MiB limit" };
  }

  const bytes = Buffer.from(payload, "base64");
  if (
    bytes.byteLength !== decodedByteLength ||
    bytes.toString("base64") !== payload
  ) {
    return { ok: false, message: "data URL image contains invalid base64" };
  }
  if (detectImageMimeType(bytes) !== mimeType) {
    return {
      ok: false,
      message: "data URL image MIME type does not match its bytes",
    };
  }
  return { ok: true, value: { mimeType, bytes } };
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

function isStrictBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(
      value,
    )
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
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}
