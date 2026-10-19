import { describe, expect, test } from "bun:test";
import { chunkMarkdown } from "../dot_local/lib/minutes/src/chunk.ts";

const frontmatter = '---\ntitle: "t"\ndate: "d"\nkind: "notes"\nsource: "s"\n---\n';

describe("chunkMarkdown (notes)", () => {
  const doc = [
    frontmatter,
    "# 会議",
    "",
    "### 概要",
    "",
    "概要の本文",
    "",
    "### 決定事項",
    "",
    "- 決定A",
    "- 決定B",
    "",
    "### 次のステップ",
    "",
    "- 次A",
    "",
    "### 詳細",
    "",
    "- **項目1:** 説明1",
    "  - 補足1",
    "- **項目2:** 説明2",
    "",
  ].join("\n");

  test("概要・決定事項・次のステップは1チャンク、詳細は箇条書き1項目ごと", () => {
    const chunks = chunkMarkdown(doc);
    expect(chunks.map((c) => [c.section, c.ts])).toEqual([
      ["概要", null],
      ["決定事項", null],
      ["次のステップ", null],
      ["詳細", null],
      ["詳細", null],
    ]);
    expect(chunks[1].text).toBe("- 決定A\n- 決定B");
    expect(chunks[3].text).toBe("- **項目1:** 説明1\n  - 補足1");
  });

  test("行番号は frontmatter を含む元の Markdown で1始まり", () => {
    const lines = doc.split("\n");
    const chunks = chunkMarkdown(doc);
    const decisions = chunks[1];
    expect(lines[decisions.startLine - 1]).toBe("### 決定事項");
    expect(lines[decisions.endLine - 1]).toBe("- 決定B");
    const item = chunks[3];
    expect(lines[item.startLine - 1]).toBe("- **項目1:** 説明1");
    expect(lines[item.endLine - 1]).toBe("  - 補足1");
  });
});

describe("chunkMarkdown (transcript)", () => {
  const block = (time: string, size: number) => `### ${time}\n\n${"あ".repeat(size)}\n`;

  test("見出しブロックを800文字以上になるまでつなげ、ts は先頭ブロックの時刻", () => {
    const doc = [
      frontmatter,
      block("00:00:00", 300),
      block("00:01:00", 300),
      block("00:02:00", 300),
      block("00:03:00", 100),
    ].join("\n");
    const chunks = chunkMarkdown(doc);
    expect(chunks.length).toBe(2);
    expect(chunks[0].section).toBe("文字起こし");
    expect(chunks[0].ts).toBe("00:00:00");
    expect(chunks[0].text).toContain("### 00:02:00");
    expect(chunks[1].ts).toBe("00:03:00");
  });

  test("1500文字を超えないように切る", () => {
    const doc = [block("00:00:00", 1000), block("00:01:00", 1000)].join("\n");
    const chunks = chunkMarkdown(doc);
    expect(chunks.length).toBe(2);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1500);
    expect(chunks[1].ts).toBe("00:01:00");
  });

  test("1つのブロックが1500文字を超える場合は行単位で切る", () => {
    const body = Array.from({ length: 5 }, () => "い".repeat(500)).join("\n");
    const chunks = chunkMarkdown(`### 00:00:00\n${body}\n`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1500);
      expect(chunk.ts).toBe("00:00:00");
    }
  });

  test("行番号が元の Markdown に対応する", () => {
    const doc = `${frontmatter}\n### 00:00:05\n\n発言\n`;
    const [chunk] = chunkMarkdown(doc);
    const lines = doc.split("\n");
    expect(lines[chunk.startLine - 1]).toBe("### 00:00:05");
    expect(lines[chunk.endLine - 1]).toBe("発言");
  });
});

describe("chunkMarkdown (見出しなし)", () => {
  test("空行区切りの段落を800〜1500文字にまとめる", () => {
    const paragraph = (c: string) => c.repeat(400);
    const doc = `${frontmatter}\n${paragraph("a")}\n\n${paragraph("b")}\n\n${paragraph("c")}\n`;
    const chunks = chunkMarkdown(doc);
    expect(chunks.map((c) => c.section)).toEqual(["本文", "本文"]);
    expect(chunks.every((c) => c.ts === null)).toBe(true);
    expect(chunks[0].text).toBe(`${paragraph("a")}\n\n${paragraph("b")}`);
    expect(chunks[1].text).toBe(paragraph("c"));
  });

  test("frontmatter だけの Markdown はチャンクなし", () => {
    expect(chunkMarkdown(frontmatter)).toEqual([]);
  });
});
