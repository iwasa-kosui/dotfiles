import { describe, expect, test } from "bun:test";

import {
  extractErrorLines,
  isBot,
  isFailedCheck,
  oneLine,
  truncate,
} from "../dot_claude/skills/pr-autofix/scripts/collect";

const RUNTIME_SCRIPTS = [
  "dot_claude/skills/pr-autofix/scripts/collect.ts",
  "dot_codex/skills/pr-autofix/scripts/collect.ts",
  "dot_cursor/skills/pr-autofix/scripts/collect.ts",
];

describe("pr-autofix collect", () => {
  test("strips the gh run view log prefix from error lines", () => {
    const log = [
      "build\tRun tests\t2026-08-18T01:02:03.1234567Z src/foo.ts(12,5): error TS2345: not assignable",
      "build\t2026-08-18T01:02:04.1234567Z ##[error]Process completed with exit code 1.",
    ].join("\n");

    expect(extractErrorLines(log)).toEqual([
      "src/foo.ts(12,5): error TS2345: not assignable",
      "##[error]Process completed with exit code 1.",
    ]);
  });

  test("keeps only lines matching an error pattern", () => {
    const log = [
      "Installing dependencies",
      "  ✕ UserService > returns a user",
      "ok 3 - unrelated line",
      "AssertionError: expected 1 to be 2",
    ].join("\n");

    expect(extractErrorLines(log)).toEqual([
      "✕ UserService > returns a user",
      "AssertionError: expected 1 to be 2",
    ]);
  });

  test("deduplicates repeated error lines and caps the list at 12", () => {
    const repeated = Array.from({ length: 5 }, () => "Error: boom").join("\n");
    expect(extractErrorLines(repeated)).toEqual(["Error: boom"]);

    const distinct = Array.from(
      { length: 30 },
      (_, i) => `Error: failure ${i}`,
    ).join("\n");
    expect(extractErrorLines(distinct)).toHaveLength(12);
  });

  test("truncates a long error line to 200 characters plus an ellipsis", () => {
    const [line] = extractErrorLines(`Error: ${"x".repeat(400)}`);
    expect(line).toHaveLength(201);
    expect(line?.endsWith("…")).toBe(true);
  });

  test("oneLine folds whitespace so a comment body fits one row", () => {
    expect(oneLine("  a\n\nb\tc  ")).toBe("a b c");
    expect(oneLine("abcdef", 3)).toBe("abc…");
    expect(truncate("abc", 3)).toBe("abc");
  });

  test("isBot matches the [bot] suffix and known bot logins", () => {
    expect(isBot("coderabbitai[bot]")).toBe(true);
    expect(isBot("CodeRabbitAI")).toBe(true);
    expect(isBot("renovate")).toBe(true);
    expect(isBot("alice")).toBe(false);
  });

  test("isFailedCheck covers the fail bucket and the failing states", () => {
    expect(isFailedCheck({ bucket: "fail" })).toBe(true);
    expect(isFailedCheck({ state: "TIMED_OUT" })).toBe(true);
    expect(isFailedCheck({ state: "STARTUP_FAILURE" })).toBe(true);
    expect(isFailedCheck({ state: "SUCCESS", bucket: "pass" })).toBe(false);
    expect(isFailedCheck({})).toBe(false);
  });

  test("every runtime ships the same collect script", async () => {
    const [claude, ...others] = await Promise.all(
      RUNTIME_SCRIPTS.map((path) => Bun.file(path).text()),
    );
    for (const [index, text] of others.entries()) {
      expect(text, RUNTIME_SCRIPTS[index + 1]).toBe(claude!);
    }
  });
});
