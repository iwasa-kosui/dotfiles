import { describe, expect, test } from "bun:test";
import { checkHost } from "../dot_local/lib/web-fetch/src/guard.ts";

describe("checkHost", () => {
  test("localhost系を拒否する", () => {
    expect(checkHost("localhost").kind).toBe("blocked");
    expect(checkHost("127.0.0.1").kind).toBe("blocked");
    expect(checkHost("0.0.0.0").kind).toBe("blocked");
    expect(checkHost("::1").kind).toBe("blocked");
  });

  test("プライベートIPを拒否する", () => {
    expect(checkHost("10.0.0.1").kind).toBe("blocked");
    expect(checkHost("172.16.0.1").kind).toBe("blocked");
    expect(checkHost("172.31.255.255").kind).toBe("blocked");
    expect(checkHost("192.168.1.1").kind).toBe("blocked");
  });

  test("172.32.0.1はプライベートIPの範囲外なので拒否しない", () => {
    expect(checkHost("172.32.0.1").kind).toBe("allowed");
  });

  test("内部ドメインを拒否する", () => {
    expect(checkHost("service.internal").kind).toBe("blocked");
    expect(checkHost("service.local").kind).toBe("blocked");
    expect(checkHost("service.corp").kind).toBe("blocked");
  });

  test("通常のドメインを許可する", () => {
    expect(checkHost("code.claude.com").kind).toBe("allowed");
  });
});
