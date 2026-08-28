import { describe, expect, test } from "bun:test";
import { isHostAllowed, parseAllowlist } from "../dot_local/lib/web-fetch/src/allowlist.ts";

describe("parseAllowlist", () => {
  test("コメント行と空行を除外し、前後の空白を取り除く", () => {
    const text = [
      "# comment",
      "",
      "  code.claude.com  ",
      "   ",
      "# another comment",
      ".github.com",
    ].join("\n");

    expect(parseAllowlist(text)).toEqual(["code.claude.com", ".github.com"]);
  });
});

describe("isHostAllowed", () => {
  test("完全一致するホストを許可する", () => {
    expect(isHostAllowed("code.claude.com", ["code.claude.com"])).toBe(true);
    expect(isHostAllowed("other.claude.com", ["code.claude.com"])).toBe(false);
  });

  test("先頭が . のエントリはドメイン自身とサブドメインの両方に一致する", () => {
    expect(isHostAllowed("github.com", [".github.com"])).toBe(true);
    expect(isHostAllowed("api.github.com", [".github.com"])).toBe(true);
    expect(isHostAllowed("deep.api.github.com", [".github.com"])).toBe(true);
  });

  test("部分一致で誤って通らない", () => {
    expect(isHostAllowed("evilgithub.com", [".github.com"])).toBe(false);
  });
});
