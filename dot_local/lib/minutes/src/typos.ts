export type Typo = { from: string; to: string };

export function parseTypos(text: string): Typo[] {
  const typos: Typo[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.startsWith("#")) continue;
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    typos.push({ from: line.slice(0, tab), to: line.slice(tab + 1) });
  }
  return typos;
}

export function applyTypos(text: string, typos: readonly Typo[]): string {
  if (typos.length === 0) return text;
  const byFirstChar = new Map<string, Typo[]>();
  for (const typo of typos) {
    const key = typo.from[0];
    const list = byFirstChar.get(key);
    if (list) list.push(typo);
    else byFirstChar.set(key, [typo]);
  }
  for (const list of byFirstChar.values()) list.sort((a, b) => b.from.length - a.from.length);

  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = byFirstChar.get(text[i])?.find((typo) => text.startsWith(typo.from, i));
    if (hit) {
      out.push(hit.to);
      i += hit.from.length;
    } else {
      out.push(text[i]);
      i += 1;
    }
  }
  return out.join("");
}

export async function loadTypos(path: string): Promise<Typo[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return parseTypos(await file.text());
}
