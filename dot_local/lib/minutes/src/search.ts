import { join } from "node:path";
import type { Config } from "./config.ts";
import { openDb } from "./db.ts";
import { dot, embedBatch, fromBlob } from "./embed.ts";

export const SEARCH_CANDIDATES = 50;
export const RRF_K = 60;

export type SearchOptions = {
  query: string;
  limit: number;
  kind?: string;
  since?: string;
  until?: string;
};

export type SearchResult = {
  rank: number;
  date: string;
  title: string;
  kind: string;
  section: string;
  ts: string | null;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
};

type ChunkRow = {
  id: number;
  path: string;
  section: string;
  ts: string | null;
  start_line: number;
  end_line: number;
  text: string;
  title: string;
  date: string;
  kind: string;
};

export function rrf(rankings: readonly (readonly number[])[], k = RRF_K): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

export function ftsQuery(query: string): string | null {
  const terms = query.split(/\s+/).filter((term) => [...term].length >= 3);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

function filterClause(options: SearchOptions): { sql: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.kind) {
    clauses.push("d.kind = ?");
    params.push(options.kind);
  }
  if (options.since) {
    clauses.push("substr(d.date, 1, 10) >= ?");
    params.push(options.since);
  }
  if (options.until) {
    clauses.push("substr(d.date, 1, 10) <= ?");
    params.push(options.until);
  }
  return { sql: clauses.map((clause) => ` AND ${clause}`).join(""), params };
}

export async function search(config: Config, options: SearchOptions): Promise<SearchResult[]> {
  const db = openDb(config);
  try {
    const filter = filterClause(options);

    const [queryVector] = await embedBatch([options.query], { host: config.ollamaHost, model: config.embedModel });
    const scored: { id: number; score: number }[] = [];
    const rows = db.query<{ id: number; embedding: Uint8Array }, string[]>(
      `SELECT c.id, c.embedding FROM chunks c JOIN documents d ON d.path = c.path
       WHERE c.embedding IS NOT NULL${filter.sql}`,
    );
    for (const row of rows.iterate(...filter.params)) {
      const vector = fromBlob(row.embedding);
      if (vector.length !== queryVector.length) continue;
      scored.push({ id: row.id, score: dot(queryVector, vector) });
    }
    scored.sort((a, b) => b.score - a.score);
    const vectorRanking = scored.slice(0, SEARCH_CANDIDATES).map((item) => item.id);

    let textRanking: number[] = [];
    const match = ftsQuery(options.query);
    if (match) {
      textRanking = db.query<{ id: number }, string[]>(
        `SELECT c.id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         JOIN documents d ON d.path = c.path
         WHERE chunks_fts MATCH ?${filter.sql} ORDER BY chunks_fts.rank LIMIT ${SEARCH_CANDIDATES}`,
      ).all(match, ...filter.params).map((row) => row.id);
    }

    const top = rrf([vectorRanking, textRanking]).slice(0, options.limit);
    const detail = db.query<ChunkRow, [number]>(
      `SELECT c.id, c.path, c.section, c.ts, c.start_line, c.end_line, c.text, d.title, d.date, d.kind
       FROM chunks c JOIN documents d ON d.path = c.path WHERE c.id = ?`,
    );
    const results: SearchResult[] = [];
    for (const { id } of top) {
      const row = detail.get(id);
      if (!row) continue;
      results.push({
        rank: results.length + 1,
        date: row.date,
        title: row.title,
        kind: row.kind,
        section: row.section,
        ts: row.ts,
        path: join(config.minutesDir, row.path),
        startLine: row.start_line,
        endLine: row.end_line,
        text: row.text,
      });
    }
    return results;
  } finally {
    db.close();
  }
}

export function formatResult(result: SearchResult): string {
  const header = [
    `${result.rank}.`,
    result.date.slice(0, 10),
    result.title,
    result.section,
    result.ts ?? "-",
  ].join("  ");
  const snippet = result.text.replace(/\s+/g, " ").slice(0, 200);
  return `${header}\n   ${result.path}:${result.startLine}\n   ${snippet}`;
}
