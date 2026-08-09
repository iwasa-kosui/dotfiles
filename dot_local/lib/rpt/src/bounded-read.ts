import type { FileHandle } from "node:fs/promises";

export async function readBounded(
  handle: FileHandle,
  maximumBytes: number,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(maximumBytes + 1);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const read = await handle.read(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (read.bytesRead === 0) {
      break;
    }
    offset += read.bytesRead;
  }
  return bytes.subarray(0, offset);
}
