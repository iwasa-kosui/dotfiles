import { describe, expect, test } from "bun:test";
import {
  extractMainContent,
  isHtml,
  render,
  toMarkdown,
} from "../dot_local/lib/web-fetch/src/markdown.ts";

describe("isHtml", () => {
  test("text/html と application/xhtml+xml を判定する", () => {
    expect(isHtml("text/html")).toBe(true);
    expect(isHtml("text/html; charset=utf-8")).toBe(true);
    expect(isHtml("application/xhtml+xml")).toBe(true);
    expect(isHtml("application/json")).toBe(false);
  });
});

describe("extractMainContent", () => {
  test("<main>を優先して取り出す", () => {
    const html = "<body><header>nav</header><main><h1>Title</h1></main></body>";
    expect(extractMainContent(html)).toBe("<h1>Title</h1>");
  });

  test("<main>が無ければ<article>を取り出す", () => {
    const html = "<body><article><p>text</p></article></body>";
    expect(extractMainContent(html)).toBe("<p>text</p>");
  });

  test("どちらも無ければ入力をそのまま返す", () => {
    const html = "<div><p>text</p></div>";
    expect(extractMainContent(html)).toBe(html);
  });
});

describe("toMarkdown", () => {
  test("見出し・リンク・表をMarkdownに変換する", () => {
    const html = [
      "<h1>Title</h1>",
      '<p><a href="https://example.com">link</a></p>',
      "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>",
    ].join("");

    const markdown = toMarkdown(html);
    expect(markdown).toContain("Title\n=====");
    expect(markdown).toContain("[link](https://example.com)");
    expect(markdown).toContain("| a | b |");
  });

  test("script要素を除去する", () => {
    const html = "<p>text</p><script>evil()</script>";
    expect(toMarkdown(html)).not.toContain("evil()");
  });
});

describe("render", () => {
  test("HTMLは<main>抽出後にMarkdown化する", () => {
    const html = "<body><nav>skip</nav><main><h1>Title</h1></main></body>";
    expect(render(html, "text/html")).toBe("Title\n=====");
  });

  test("application/jsonはそのまま返す", () => {
    const body = '{"key":"value"}';
    expect(render(body, "application/json")).toBe(body);
  });
});
