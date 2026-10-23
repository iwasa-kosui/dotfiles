import { ExternalError } from "./errors.ts";

export const EMBED_BATCH = 16;
export const EMBED_TEXT_LIMIT = 4000;

export type OllamaOptions = { host: string; model: string };

export class EmbedRejectedError extends ExternalError {}

export function l2normalize(vector: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(vector);
  let sum = 0;
  for (const value of out) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return out;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function embedInput(title: string, date: string, section: string, text: string): string {
  return `会議: ${title}\n日付: ${date}\n節: ${section}\n\n${text.slice(0, EMBED_TEXT_LIMIT)}`;
}

export function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function fromBlob(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

function baseUrl(host: string): string {
  const withScheme = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return withScheme.replace(/\/+$/, "");
}

export async function embedBatch(input: string[], options: OllamaOptions): Promise<Float32Array[]> {
  const hint = `ollama を起動し、次のコマンドでモデルを取得してください: ollama pull ${options.model}`;
  let response: Response;
  try {
    response = await fetch(`${baseUrl(options.host)}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: options.model, input }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExternalError(`ollama に接続できません (${options.host}): ${message}\n${hint}`);
  }
  if (!response.ok) {
    const body = (await response.text()).trim();
    if (response.status === 404) {
      throw new ExternalError(`ollama にモデル ${options.model} がありません: ${body}\n${hint}`);
    }
    throw new EmbedRejectedError(`ollama がエラーを返しました (HTTP ${response.status}): ${body}`);
  }
  const json = (await response.json()) as { embeddings?: number[][] };
  if (!Array.isArray(json.embeddings) || json.embeddings.length !== input.length) {
    throw new ExternalError("ollama の応答に埋め込みが含まれていません");
  }
  return json.embeddings.map(l2normalize);
}
