import { describe, expect, test } from "bun:test";
import { dot, embedInput, fromBlob, l2normalize, toBlob } from "../dot_local/lib/minutes/src/embed.ts";
import { ftsQuery, rrf } from "../dot_local/lib/minutes/src/search.ts";

describe("rrf", () => {
  test("両方の順位に出る項目が上位になる", () => {
    const result = rrf([[1, 2, 3], [3, 4]]);
    expect(result[0].id).toBe(3);
    expect(result.map((r) => r.id).sort()).toEqual([1, 2, 3, 4]);
  });

  test("k=60 のスコアを足し合わせる", () => {
    const result = rrf([[10, 20], [20]]);
    expect(result[0].id).toBe(20);
    expect(result[0].score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(result[1].score).toBeCloseTo(1 / 61, 10);
  });

  test("空の順位は無視する", () => {
    expect(rrf([[], [5]])).toEqual([{ id: 5, score: 1 / 61 }]);
    expect(rrf([[], []])).toEqual([]);
  });
});

describe("ftsQuery", () => {
  test("3文字以上の語を引用符で囲み OR で結ぶ", () => {
    expect(ftsQuery("認証ポータル の 設計")).toBe('"認証ポータル"');
    expect(ftsQuery("認証ポ 設計書")).toBe('"認証ポ" OR "設計書"');
  });

  test("3文字以上の語がなければ null", () => {
    expect(ftsQuery("認証 UI")).toBeNull();
  });

  test("引用符をエスケープする", () => {
    expect(ftsQuery('a"bc')).toBe('"a""bc"');
  });
});

describe("embed helpers", () => {
  test("l2normalize は長さ1にする", () => {
    const v = l2normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(dot(v, v)).toBeCloseTo(1);
  });

  test("ゼロベクトルはそのまま返す", () => {
    expect(Array.from(l2normalize([0, 0]))).toEqual([0, 0]);
  });

  test("BLOB に往復できる", () => {
    const v = l2normalize([1, 2, 3]);
    expect(Array.from(fromBlob(toBlob(v)))).toEqual(Array.from(v));
  });

  test("埋め込み入力は先頭4000文字までの本文を含む", () => {
    const input = embedInput("会議", "2026-01-01", "概要", "あ".repeat(5000));
    expect(input.startsWith("会議: 会議\n日付: 2026-01-01\n節: 概要\n\n")).toBe(true);
    expect(input.length).toBe("会議: 会議\n日付: 2026-01-01\n節: 概要\n\n".length + 4000);
  });
});
