import { describe, expect, test } from "bun:test";
import { fetchAllowed } from "../dot_local/lib/web-fetch/src/fetch.ts";

function stubFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    const route = routes[url];
    if (!route) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return route();
  }) as typeof fetch;
}

describe("fetchAllowed", () => {
  test("許可外ドメインへのリダイレクトを拒否する", async () => {
    const fetchImpl = stubFetch({
      "https://allowed.example/redirect": () =>
        new Response(null, { status: 302, headers: { Location: "https://blocked.example/target" } }),
    });

    const outcome = await fetchAllowed("https://allowed.example/redirect", {
      allowlist: ["allowed.example"],
      fetchImpl,
    });

    expect(outcome.kind).toBe("rejected");
  });

  test("プライベートIPへのリダイレクトを拒否する", async () => {
    const fetchImpl = stubFetch({
      "https://allowed.example/redirect": () =>
        new Response(null, { status: 302, headers: { Location: "http://10.0.0.1/target" } }),
    });

    const outcome = await fetchAllowed("https://allowed.example/redirect", {
      // 10.0.0.1をallowlistに含めておき、checkHostの判定が効いていることを確かめる
      allowlist: ["allowed.example", "10.0.0.1"],
      fetchImpl,
    });

    expect(outcome.kind).toBe("rejected");
  });

  test("ホップ上限を超えたリダイレクトを拒否する", async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) {
      routes[`https://allowed.example/${i}`] = () =>
        new Response(null, {
          status: 302,
          headers: { Location: `https://allowed.example/${i + 1}` },
        });
    }

    const fetchImpl = stubFetch(routes);

    const outcome = await fetchAllowed("https://allowed.example/0", {
      allowlist: ["allowed.example"],
      fetchImpl,
      maxHops: 2,
    });

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.reason).toContain("上限");
    }
  });

  test("許可ドメイン内のリダイレクトには追従する", async () => {
    const fetchImpl = stubFetch({
      "https://allowed.example/start": () =>
        new Response(null, { status: 302, headers: { Location: "https://allowed.example/final" } }),
      "https://allowed.example/final": () =>
        new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
    });

    const outcome = await fetchAllowed("https://allowed.example/start", {
      allowlist: ["allowed.example"],
      fetchImpl,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.finalUrl).toBe("https://allowed.example/final");
      expect(outcome.body).toBe("hello");
    }
  });

  test("maxBytesを超えた本文は切り捨てる", async () => {
    const fetchImpl = stubFetch({
      "https://allowed.example/big": () =>
        new Response("0123456789", { status: 200, headers: { "content-type": "text/plain" } }),
    });

    const outcome = await fetchAllowed("https://allowed.example/big", {
      allowlist: ["allowed.example"],
      fetchImpl,
      maxBytes: 5,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.body).toBe("01234");
    }
  });

  test("404はhttp-errorになる", async () => {
    const fetchImpl = stubFetch({
      "https://allowed.example/missing": () => new Response(null, { status: 404 }),
    });

    const outcome = await fetchAllowed("https://allowed.example/missing", {
      allowlist: ["allowed.example"],
      fetchImpl,
    });

    expect(outcome.kind).toBe("http-error");
    if (outcome.kind === "http-error") {
      expect(outcome.status).toBe(404);
      expect(outcome.url).toBe("https://allowed.example/missing");
    }
  });
});
