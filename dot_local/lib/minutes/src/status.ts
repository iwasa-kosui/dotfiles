import { existsSync } from "node:fs";
import type { Config } from "./config.ts";
import { getMeta, openDb } from "./db.ts";

export function kindOfPath(path: string): string {
  return /- (notes|transcript|chat)(?: \(\d+\))?\.md$/.exec(path)?.[1] ?? "other";
}

export function formatTokyoTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

export function runStatus(config: Config): number {
  const db = openDb(config);
  try {
    const counts = new Map<string, number>();
    for (const row of db.query<{ path: string }, []>("SELECT path FROM sources").all()) {
      const kind = kindOfPath(row.path);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const byKind = ["notes", "transcript", "chat", "other"]
      .filter((kind) => counts.has(kind))
      .map((kind) => `${kind}: ${counts.get(kind)}`)
      .join(", ");
    const chunkCount = db.query<{ n: number }, []>("SELECT count(*) AS n FROM chunks").get()!.n;
    const pending = db.query<{ n: number }, []>("SELECT count(*) AS n FROM chunks WHERE embedding IS NULL").get()!.n;
    const last = db.query<{ at: string | null }, []>("SELECT max(ingested_at) AS at FROM sources").get()!.at;

    console.log(`取り込み済み: ${total} 件${byKind ? ` (${byKind})` : ""}`);
    console.log(`チャンク数: ${chunkCount}`);
    console.log(`埋め込み未作成: ${pending}`);
    console.log(`最終取り込み: ${last ? formatTokyoTime(last) : "なし"}`);
    console.log(`埋め込みモデル: ${getMeta(db, "model") ?? "未作成"} (次元数 ${getMeta(db, "dimension") ?? "未作成"})`);
    console.log(`Markdown 置き場: ${config.minutesDir}`);
    console.log(`raw: ${config.rawDir}`);
    console.log(`index: ${config.dbPath}`);
    console.log(`誤字辞書: ${config.typosPath}${existsSync(config.typosPath) ? "" : " (なし)"}`);
    console.log(`ollama: ${config.ollamaHost} (${config.embedModel})`);
    return 0;
  } finally {
    db.close();
  }
}
