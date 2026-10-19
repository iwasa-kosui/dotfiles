import { applyTypos, type Typo } from "./typos.ts";

export type DocMeta = { title: string; date: string; kind: string; source: string };

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

export function buildFrontmatter(meta: DocMeta): string {
  return [
    "---",
    `title: ${JSON.stringify(meta.title)}`,
    `date: ${JSON.stringify(meta.date)}`,
    `kind: ${JSON.stringify(meta.kind)}`,
    `source: ${JSON.stringify(meta.source)}`,
    "---",
    "",
  ].join("\n");
}

export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: "", body: text };
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) return { frontmatter: "", body: text };
  const cut = end + 5;
  return { frontmatter: text.slice(0, cut), body: text.slice(cut) };
}

export function parseFrontmatter(text: string): Partial<DocMeta> {
  const meta: Record<string, string> = {};
  for (const line of splitFrontmatter(text).frontmatter.split("\n")) {
    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {}
    }
    meta[match[1]] = value;
  }
  return meta;
}

export function applyTyposToDocument(text: string, typos: readonly Typo[]): string {
  const { frontmatter, body } = splitFrontmatter(text);
  return frontmatter + applyTypos(body, typos);
}
