import { describe, expect, test } from "bun:test";
import { applyTyposToDocument } from "../dot_local/lib/minutes/src/document.ts";
import { applyTypos, parseTypos } from "../dot_local/lib/minutes/src/typos.ts";

describe("parseTypos", () => {
  test("コメント行・空行・タブなしの行を無視する", () => {
    const text = "# comment\n\n誤り\t正しい\nタブなし\n結び\tMusubi\r\n";
    expect(parseTypos(text)).toEqual([
      { from: "誤り", to: "正しい" },
      { from: "結び", to: "Musubi" },
    ]);
  });

  test("誤りと正しい表記が同じ行も有効な行として残す", () => {
    expect(parseTypos("結びつ\t結びつ\n")).toEqual([{ from: "結びつ", to: "結びつ" }]);
  });
});

describe("applyTypos", () => {
  test("辞書が空なら何もしない", () => {
    expect(applyTypos("本文", [])).toBe("本文");
  });

  test("各位置で一致する最長の誤りを置換する", () => {
    const typos = parseTypos("ab\tX\nabc\tY\n");
    expect(applyTypos("abc ab a", typos)).toBe("Y X a");
  });

  test("同じ表記の行は短い誤りによる部分置換を防ぐ", () => {
    const typos = parseTypos("結び\tMusubi\n結びつ\t結びつ\n");
    expect(applyTypos("結びつく", typos)).toBe("結びつく");
    expect(applyTypos("結びの件", typos)).toBe("Musubiの件");
  });

  test("置換結果が別の誤りに一致しても再置換しない", () => {
    const typos = parseTypos("A\tB\nB\tC\n");
    expect(applyTypos("AB", typos)).toBe("BC");
  });

  test("置換後の文字列の $ を特殊扱いしない", () => {
    expect(applyTypos("x", parseTypos("x\t$&$1\n"))).toBe("$&$1");
  });
});

describe("applyTyposToDocument", () => {
  test("frontmatter には適用せず本文だけに適用する", () => {
    const doc = '---\ntitle: "誤り会議"\nsource: "誤り.docx"\n---\n\n誤りがある\n';
    const out = applyTyposToDocument(doc, parseTypos("誤り\t正解\n"));
    expect(out).toBe('---\ntitle: "誤り会議"\nsource: "誤り.docx"\n---\n\n正解がある\n');
  });

  test("frontmatter が無ければ全体に適用する", () => {
    expect(applyTyposToDocument("誤り\n", parseTypos("誤り\t正解\n"))).toBe("正解\n");
  });
});
