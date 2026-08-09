import { describe, expect, test } from "bun:test";
import {
  buildRemoteCommand,
  parseBridgeArgs,
} from "../dot_local/lib/nvim-pr-review-bridge";

describe("nvim PR review bridge", () => {
  test("accepts exactly open and one branch argument", () => {
    expect(parseBridgeArgs(["open", "feat/review"])).toEqual({ branch: "feat/review" });
    expect(parseBridgeArgs(["open"])).toBeUndefined();
    expect(parseBridgeArgs(["open", "feat/review", "extra"])).toBeUndefined();
    expect(parseBridgeArgs(["list", "feat/review"])).toBeUndefined();
  });

  test("preserves special branch characters in a base64 JSON payload", () => {
    const branch = "feat/$(touch hacked);quote'and\"double";
    const command = buildRemoteCommand("/tmp/nvim.sock", "/repo path", branch);
    expect(command.slice(0, 4)).toEqual(["nvim", "--server", "/tmp/nvim.sock", "--remote-expr"]);

    const encoded = command[4].match(/, \"([A-Za-z0-9+/=]+)\"\)$/)?.[1];
    expect(encoded).toBeDefined();
    expect(JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"))).toEqual({
      cwd: "/repo path",
      branch,
    });
  });
});
