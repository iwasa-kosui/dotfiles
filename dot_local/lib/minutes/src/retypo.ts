import { join } from "node:path";
import type { Config } from "./config.ts";
import { applyTyposToDocument } from "./document.ts";
import { runIndex } from "./indexer.ts";
import { loadTypos } from "./typos.ts";

export async function runRetypo(config: Config): Promise<number> {
  const typos = await loadTypos(config.typosPath);
  let count = 0;
  for await (const path of new Bun.Glob("**/*.md").scan({ cwd: config.rawDir, onlyFiles: true })) {
    const raw = await Bun.file(join(config.rawDir, path)).text();
    await Bun.write(join(config.minutesDir, path), applyTyposToDocument(raw, typos));
    count++;
  }
  console.log(`retypo: ${count} 件に誤字辞書 (${typos.length} 件) を適用`);
  return runIndex(config);
}
