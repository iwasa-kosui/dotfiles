import { describe, expect, test } from "bun:test";
import {
  isTargetFile,
  outputRelPath,
  parseFileName,
  postprocess,
} from "../dot_local/lib/minutes/src/convert.ts";
import {
  buildFrontmatter,
  parseFrontmatter,
  splitFrontmatter,
} from "../dot_local/lib/minutes/src/document.ts";

describe("parseFileName", () => {
  test("会議名・日時・Gemini によるメモ", () => {
    const meta = parseFileName("1on1 (kosui_松永さん) - 2026_09_25 16_03 JST - Gemini によるメモ.docx");
    expect(meta).toEqual({
      key: "1on1 (kosui_松永さん) - 2026_09_25 16_03 JST - Gemini によるメモ",
      title: "1on1 (kosui_松永さん)",
      date: "2026-09-25T16:03:00+09:00",
      kind: "notes",
      source: "1on1 (kosui_松永さん) - 2026_09_25 16_03 JST - Gemini によるメモ.docx",
      copy: "",
    });
  });

  test("会議名なしは「無題の会議」にする", () => {
    const meta = parseFileName("2026_02_27 16_00 JST に開始した会議 - Gemini によるメモ.docx");
    expect(meta?.title).toBe("無題の会議");
    expect(meta?.date).toBe("2026-02-27T16:00:00+09:00");
    expect(meta?.kind).toBe("notes");
  });

  test("Chat.txt と Transcript.docx", () => {
    const chat = parseFileName("認証ポータルUI相談 - 2025_09_29 15_29 JST～Chat.txt");
    expect(chat?.title).toBe("認証ポータルUI相談");
    expect(chat?.kind).toBe("chat");
    const transcript = parseFileName("認証ポータルUI相談 - 2026_10_16 16_30 JST～Transcript.docx");
    expect(transcript?.kind).toBe("transcript");
    expect(transcript?.date).toBe("2026-10-16T16:30:00+09:00");
  });

  test("GMT+9 形式", () => {
    const meta = parseFileName("wct-qwfi-srw (2025-05-15 09_28 GMT+9)～Transcript.docx");
    expect(meta?.title).toBe("wct-qwfi-srw");
    expect(meta?.date).toBe("2025-05-15T09:28:00+09:00");
    expect(meta?.kind).toBe("transcript");
  });

  test("重複番号はキーに残し、種別と日時と会議名の判定からは除く", () => {
    const a = parseFileName("顧客ID管理(CIAM) SU - 2026_09_09 10_59 JST - Gemini によるメモ.docx");
    const b = parseFileName("顧客ID管理(CIAM) SU - 2026_09_09 10_59 JST - Gemini によるメモ(1).docx");
    expect(a?.key).toBe("顧客ID管理(CIAM) SU - 2026_09_09 10_59 JST - Gemini によるメモ");
    expect(b?.key).toBe("顧客ID管理(CIAM) SU - 2026_09_09 10_59 JST - Gemini によるメモ(1)");
    expect(b?.title).toBe("顧客ID管理(CIAM) SU");
    expect(b?.kind).toBe("notes");
    expect(b?.date).toBe(a?.date);
    expect(a?.copy).toBe("");
    expect(b?.copy).toBe(" (1)");
    const chat = parseFileName("X - 2026_01_02 03_04 JST～Chat (2).txt");
    expect(chat?.key).toBe("X - 2026_01_02 03_04 JST～Chat (2)");
    expect(chat?.copy).toBe(" (2)");
  });

  test("Chat.txt 以外の名前のチャット記録を chat として扱う", () => {
    const demo = parseFileName("[要録画]デモ2 (2024-04-22 10_32 GMT+9).txt");
    expect(demo?.kind).toBe("chat");
    expect(demo?.title).toBe("[要録画]デモ2");
    expect(demo?.date).toBe("2024-04-22T10:32:00+09:00");
    expect(parseFileName("CP ユーザー連携解除 (2023-06-30 13_32 GMT+9).txt")?.title).toBe("CP ユーザー連携解除");
    const record = parseFileName("att-fncq-ois (2026-02-27 16_19 GMT+9) - チャットの記録.txt");
    expect(record?.kind).toBe("chat");
    expect(record?.title).toBe("att-fncq-ois");
    expect(record?.key).toBe("att-fncq-ois (2026-02-27 16_19 GMT+9) - チャットの記録");
  });

  test("日時のない txt は null", () => {
    expect(parseFileName("memo.txt")).toBeNull();
  });

  test("NFD のファイル名も NFC に正規化して判定する", () => {
    const meta = parseFileName("認証ポータルUI相談 - 2025_09_29 15_29 JST～Chat.txt".normalize("NFD"));
    expect(meta?.title).toBe("認証ポータルUI相談");
  });

  test("日時が取れないファイルは null", () => {
    expect(parseFileName("メモ - Gemini によるメモ.docx")).toBeNull();
    expect(parseFileName("random.docx")).toBeNull();
  });
});

describe("isTargetFile", () => {
  test("docx と Chat.txt だけを対象にする", () => {
    expect(isTargetFile("a - Gemini によるメモ.docx")).toBe(true);
    expect(isTargetFile("a～Chat.txt")).toBe(true);
    expect(isTargetFile("a～Chat (1).txt")).toBe(true);
    expect(isTargetFile("a～Recording.mp4")).toBe(false);
    expect(isTargetFile("notes.txt")).toBe(false);
    expect(isTargetFile("[要録画]デモ2 (2024-04-22 10_32 GMT+9).txt")).toBe(true);
    expect(isTargetFile("att-fncq-ois (2026-02-27 16_19 GMT+9) - チャットの記録.txt")).toBe(true);
    expect(isTargetFile("a (2024-04-22 10_32 GMT+9).mp4")).toBe(false);
    expect(isTargetFile("~$a.docx")).toBe(false);
  });
});

describe("outputRelPath", () => {
  test("年ディレクトリと日時と会議名と種別", () => {
    const meta = parseFileName("1on1 (kosui_松永さん) - 2026_09_25 16_03 JST - Gemini によるメモ.docx")!;
    expect(outputRelPath(meta)).toBe("2026/2026-09-25 1603 1on1 (kosui_松永さん) - notes.md");
  });

  test("重複番号があるとき種別の後ろに付ける", () => {
    const meta = parseFileName("顧客ID管理(CIAM) SU - 2026_09_09 10_59 JST - Gemini によるメモ(1).docx")!;
    expect(outputRelPath(meta)).toBe("2026/2026-09-09 1059 顧客ID管理(CIAM) SU - notes (1).md");
  });

  test("会議名の / と : を全角にする", () => {
    const meta = { ...parseFileName("a - 2026_09_25 16_03 JST～Chat.txt")!, title: "A/B: C" };
    expect(outputRelPath(meta)).toBe("2026/2026-09-25 1603 A／B： C - chat.md");
  });
});

describe("postprocess", () => {
  test("タイムスタンプリンクを (HH:MM:SS) にする", () => {
    expect(postprocess("決定 [<u>00:01:27</u>](#section-1)")).toBe("決定 (00:01:27)");
  });

  test("mailto リンクと他の <u> を中身だけにする", () => {
    expect(postprocess("[<u>山田</u>](mailto:a@example.com) and <u>強調</u>")).toBe("山田 and 強調");
  });

  test("外側に括弧があるタイムスタンプリンクも (HH:MM:SS) にする", () => {
    expect(postprocess("決定 ([<u>02:21:40</u>](#section-20))")).toBe("決定 (02:21:40)");
    expect(postprocess("([<u>00:12:25</u>](#section-11)) ([<u>00:14:17</u>](#section-13))")).toBe("(00:12:25) (00:14:17)");
    expect(postprocess("A [<u>00:12:25</u>](#s-1) B ([<u>00:14:17</u>](#s-2))")).toBe("A (00:12:25) B (00:14:17)");
  });

  test("日本語の文字どうしの間の半角空白を詰める", () => {
    expect(postprocess("プロ と 管理 大変 だ な 。")).toBe("プロと管理大変だな。");
    expect(postprocess("ミーティング  です ー ね、 はい")).toBe("ミーティングですーね、はい");
  });

  test("英数字と日本語の間の空白と行頭の空白は残す", () => {
    expect(postprocess("API を 使う 2 つ")).toBe("API を使う 2 つ");
    expect(postprocess("- 項目\n  - 補足 です")).toBe("- 項目\n  - 補足です");
  });

  test("画像を消す", () => {
    expect(postprocess("前![alt](image1.png)後")).toBe("前後");
  });
});

describe("frontmatter", () => {
  const meta = { title: 'A: "B"', date: "2026-09-25T16:03:00+09:00", kind: "notes", source: "a.docx" };

  test("build と parse が往復する", () => {
    const text = `${buildFrontmatter(meta)}\n本文\n`;
    expect(parseFrontmatter(text)).toEqual(meta);
    expect(splitFrontmatter(text).body).toBe("\n本文\n");
  });
});
