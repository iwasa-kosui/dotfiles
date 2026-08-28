import { isHostAllowed, type Allowlist } from "./allowlist.ts";
import { checkHost } from "./guard.ts";

export type FetchOutcome =
  | { kind: "ok"; finalUrl: string; contentType: string; body: string }
  | { kind: "rejected"; reason: string }
  | { kind: "http-error"; status: number; url: string }
  | { kind: "network-error"; message: string };

export type FetchOptions = {
  allowlist: Allowlist;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  maxHops?: number;
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_HOPS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type ValidatedUrl = { kind: "ok"; url: URL } | { kind: "rejected"; reason: string };

function validateUrl(rawUrl: string, allowlist: Allowlist): ValidatedUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "rejected", reason: `URLを解析できません: ${rawUrl}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "rejected", reason: `対応していないスキームです: ${url.protocol}` };
  }
  if (!isHostAllowed(url.hostname, allowlist)) {
    return { kind: "rejected", reason: `許可されていないドメインです: ${url.hostname}` };
  }
  const guard = checkHost(url.hostname);
  if (guard.kind === "blocked") {
    return { kind: "rejected", reason: guard.reason };
  }
  return { kind: "ok", url };
}

async function readTruncatedBody(response: Response, maxBytes: number): Promise<string> {
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const truncated = bytes.length > maxBytes ? bytes.slice(0, maxBytes) : bytes;
  return new TextDecoder("utf-8", { fatal: false }).decode(truncated);
}

export async function fetchAllowed(rawUrl: string, options: FetchOptions): Promise<FetchOutcome> {
  const {
    allowlist,
    fetchImpl = fetch,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxHops = DEFAULT_MAX_HOPS,
  } = options;

  let currentUrl = rawUrl;

  for (let hop = 0; ; hop++) {
    const validated = validateUrl(currentUrl, allowlist);
    if (validated.kind === "rejected") {
      return validated;
    }
    const { url } = validated;

    if (hop > maxHops) {
      return { kind: "rejected", reason: `リダイレクトの上限(${maxHops}回)を超えました` };
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "web-fetch/0.1",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return { kind: "network-error", message: err instanceof Error ? err.message : String(err) };
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        return { kind: "rejected", reason: "リダイレクト先が指定されていません" };
      }
      currentUrl = new URL(location, url).toString();
      continue;
    }

    if (response.status >= 400) {
      return { kind: "http-error", status: response.status, url: url.toString() };
    }

    const contentType = response.headers.get("content-type") ?? "";
    try {
      const body = await readTruncatedBody(response, maxBytes);
      return { kind: "ok", finalUrl: url.toString(), contentType, body };
    } catch (err) {
      return { kind: "network-error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}
