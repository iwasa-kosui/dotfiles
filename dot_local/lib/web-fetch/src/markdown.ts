import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const REMOVED_TAGS = ["script", "style", "nav", "header", "footer", "aside", "noscript"];

export function isHtml(contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "text/html" || type === "application/xhtml+xml";
}

// <main> → <article> → <body> の順に中身を取り出す。どれも無ければ入力をそのまま返す。
// 正規表現による抽出のため、同名タグの入れ子には対応しない。
export function extractMainContent(html: string): string {
  const patterns = [/<main[^>]*>([\s\S]*?)<\/main>/i, /<article[^>]*>([\s\S]*?)<\/article>/i, /<body[^>]*>([\s\S]*?)<\/body>/i];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return html;
}

export function toMarkdown(html: string): string {
  const service = new TurndownService();
  service.use(gfm);
  service.remove(REMOVED_TAGS);
  return service.turndown(html);
}

export function render(body: string, contentType: string): string {
  if (isHtml(contentType)) {
    return toMarkdown(extractMainContent(body));
  }
  return body;
}
