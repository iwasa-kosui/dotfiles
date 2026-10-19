import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { chunkMarkdown } from "./chunk.ts";
import type { Config } from "./config.ts";
import { getMeta, openDb, setMeta } from "./db.ts";
import { parseFrontmatter, sha256 } from "./document.ts";
import { EMBED_BATCH, embedBatch, embedInput, toBlob } from "./embed.ts";

type PendingChunk = { id: number; section: string; text: string; title: string; date: string };

async function listMarkdown(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob("**/*.md").scan({ cwd: dir, onlyFiles: true })) files.push(file);
  return files.sort();
}

function removeChunks(db: Database, path: string): void {
  db.query("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE path = ?)").run(path);
  db.query("DELETE FROM chunks WHERE path = ?").run(path);
}

function replaceDocument(db: Database, path: string, text: string, hash: string): void {
  const meta = parseFrontmatter(text);
  const fallbackTitle = path.split("/").pop()!.replace(/\.md$/, "");
  const chunks = chunkMarkdown(text);
  const insertChunk = db.query(
    "INSERT INTO chunks (path, section, ts, start_line, end_line, text) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertFts = db.query("INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)");
  db.transaction(() => {
    removeChunks(db, path);
    for (const chunk of chunks) {
      const result = insertChunk.run(path, chunk.section, chunk.ts, chunk.startLine, chunk.endLine, chunk.text);
      insertFts.run(Number(result.lastInsertRowid), chunk.text);
    }
    db.query(
      `INSERT INTO documents (path, sha256, title, date, kind) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, title = excluded.title, date = excluded.date, kind = excluded.kind`,
    ).run(path, hash, meta.title || fallbackTitle, meta.date || "", meta.kind || "");
  })();
}

export async function runIndex(config: Config): Promise<number> {
  const started = performance.now();
  const db = openDb(config);
  try {
    const known = new Map(
      db.query<{ path: string; sha256: string }, []>("SELECT path, sha256 FROM documents").all().map((row) => [row.path, row.sha256]),
    );
    const seen = new Set<string>();
    let updated = 0;
    for (const path of await listMarkdown(config.minutesDir)) {
      seen.add(path);
      const text = await Bun.file(join(config.minutesDir, path)).text();
      const hash = sha256(text);
      if (known.get(path) === hash) continue;
      replaceDocument(db, path, text, hash);
      updated++;
    }

    let removed = 0;
    for (const path of known.keys()) {
      if (seen.has(path)) continue;
      db.transaction(() => {
        removeChunks(db, path);
        db.query("DELETE FROM documents WHERE path = ?").run(path);
      })();
      removed++;
    }

    const previousModel = getMeta(db, "model");
    if (previousModel !== null && previousModel !== config.embedModel) {
      db.query("UPDATE chunks SET embedding = NULL").run();
    }
    setMeta(db, "model", config.embedModel);

    const pending = db.query<PendingChunk, []>(
      `SELECT c.id, c.section, c.text, d.title, d.date FROM chunks c
       JOIN documents d ON d.path = c.path WHERE c.embedding IS NULL ORDER BY c.id`,
    ).all();
    const update = db.query("UPDATE chunks SET embedding = ? WHERE id = ?");
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      const batch = pending.slice(i, i + EMBED_BATCH);
      const vectors = await embedBatch(
        batch.map((chunk) => embedInput(chunk.title, chunk.date, chunk.section, chunk.text)),
        { host: config.ollamaHost, model: config.embedModel },
      );
      db.transaction(() => {
        batch.forEach((chunk, index) => update.run(toBlob(vectors[index]), chunk.id));
      })();
      setMeta(db, "dimension", String(vectors[0].length));
    }

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`index: ドキュメント更新 ${updated} 件、削除 ${removed} 件、埋め込み ${pending.length} チャンク (${seconds} 秒)`);
    return 0;
  } finally {
    db.close();
  }
}
