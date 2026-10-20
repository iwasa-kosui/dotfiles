import { describe, expect, test } from "bun:test";
import { formatTokyoTime, kindOfPath } from "../dot_local/lib/minutes/src/status.ts";

describe("kindOfPath", () => {
  test("重複番号で終わる出力パスも kind を判定する", () => {
    expect(kindOfPath("2026/2026-09-09 1059 会議 - notes.md")).toBe("notes");
    expect(kindOfPath("2026/2026-09-09 1059 会議 - notes (1).md")).toBe("notes");
    expect(kindOfPath("2026/2026-09-09 1059 会議 - transcript (2).md")).toBe("transcript");
    expect(kindOfPath("2026/2026-09-09 1059 会議 - chat.md")).toBe("chat");
    expect(kindOfPath("2026/other.md")).toBe("other");
  });
});

describe("formatTokyoTime", () => {
  test("UTC の時刻を Asia/Tokyo の YYYY-MM-DD HH:MM にする", () => {
    expect(formatTokyoTime("2026-10-20T05:03:09.123Z")).toBe("2026-10-20 14:03");
  });

  test("日付をまたぐときは日付も進める", () => {
    expect(formatTokyoTime("2026-12-31T15:30:00.000Z")).toBe("2027-01-01 00:30");
  });
});
