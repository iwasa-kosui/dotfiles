import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Config } from "./config.ts";
import { isTargetFile, outputRelPath, pandocToMarkdown, parseFileName, postprocess } from "./convert.ts";
import { openDb } from "./db.ts";
import { applyTyposToDocument, buildFrontmatter, sha256 } from "./document.ts";
import { ExternalError, UsageError } from "./errors.ts";
import { run } from "./external.ts";
import { runIndex } from "./indexer.ts";
import { loadTypos, type Typo } from "./typos.ts";

export type IngestOptions = { deleteSource: boolean; noIndex: boolean };

type Outcome = "added" | "updated" | "skipped" | "warning" | "error";
type Counters = { added: string[]; updated: string[]; skipped: number; warnings: number; errors: number };

async function collectFiles(root: string): Promise<string[]> {
  if (!(await stat(root)).isDirectory()) return isTargetFile(basename(root)) ? [root] : [];
  const files: string[] = [];
  for await (const file of new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true })) {
    if (isTargetFile(basename(file))) files.push(join(root, file));
  }
  return files.sort();
}

async function processFile(config: Config, db: ReturnType<typeof openDb>, typos: Typo[], file: string, counters: Counters): Promise<Outcome> {
  const name = basename(file);
  const meta = parseFileName(name);
  if (!meta) {
    console.error(`警告: 日時または種別を取得できないためスキップします: ${name}`);
    return "warning";
  }

  let body: string;
  try {
    body = meta.kind === "chat" ? await Bun.file(file).text() : postprocess(await pandocToMarkdown(file));
  } catch (error) {
    if (!(error instanceof ExternalError)) throw error;
    console.error(error.message);
    return "error";
  }
  body = `${body.trim()}\n`;

  const hash = sha256(body);
  const existing = db.query<{ sha256: string }, [string]>("SELECT sha256 FROM sources WHERE key = ?").get(meta.key);
  if (existing && existing.sha256 === hash) return "skipped";

  const rel = outputRelPath(meta);
  const clash = db.query<{ key: string }, [string, string]>("SELECT key FROM sources WHERE path = ? AND key != ?").get(rel, meta.key);
  if (clash) {
    console.error(`警告: 出力先が同じ別のファイルが取り込み済みのためスキップします: ${name} (${clash.key})`);
    return "warning";
  }
  const raw = `${buildFrontmatter(meta)}\n${body}`;
  await Bun.write(join(config.rawDir, rel), raw);
  const target = join(config.minutesDir, rel);
  await Bun.write(target, applyTyposToDocument(raw, typos));
  db.query(
    `INSERT INTO sources (key, sha256, path, ingested_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET sha256 = excluded.sha256, path = excluded.path, ingested_at = excluded.ingested_at`,
  ).run(meta.key, hash, rel, new Date().toISOString());

  (existing ? counters.updated : counters.added).push(target);
  return existing ? "updated" : "added";
}

async function processInput(config: Config, db: ReturnType<typeof openDb>, typos: Typo[], input: string, counters: Counters): Promise<boolean> {
  let tmp: string | null = null;
  const before = { warnings: counters.warnings, errors: counters.errors };
  try {
    let root = input;
    if (!(await stat(input)).isDirectory() && /\.zip$/i.test(input)) {
      tmp = await mkdtemp(join(tmpdir(), "minutes-"));
      const result = await run(["ditto", "-x", "-k", input, tmp]);
      if (result.exitCode !== 0) {
        console.error(`ditto が失敗しました (${basename(input)}): ${result.stderr.trim()}`);
        counters.errors++;
        return false;
      }
      root = tmp;
    }
    for (const file of await collectFiles(root)) {
      const outcome = await processFile(config, db, typos, file, counters);
      if (outcome === "skipped") counters.skipped++;
      else if (outcome === "warning") counters.warnings++;
      else if (outcome === "error") counters.errors++;
    }
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
  return counters.warnings === before.warnings && counters.errors === before.errors;
}

export async function runIngest(config: Config, paths: string[], options: IngestOptions): Promise<number> {
  if (paths.length === 0) throw new UsageError("ingest にはパスを1つ以上指定してください");
  const inputs = paths.map((path) => resolve(path));
  for (const input of inputs) {
    try {
      await stat(input);
    } catch {
      throw new UsageError(`パスが存在しません: ${input}`);
    }
  }

  const typos = await loadTypos(config.typosPath);
  const counters: Counters = { added: [], updated: [], skipped: 0, warnings: 0, errors: 0 };
  const db = openDb(config);
  try {
    for (const input of inputs) {
      const clean = await processInput(config, db, typos, input, counters);
      if (options.deleteSource && clean) await rm(input, { recursive: true, force: true });
      else if (options.deleteSource) console.error(`エラーまたは警告があったため削除しません: ${input}`);
    }
  } finally {
    db.close();
  }

  console.log(`added: ${counters.added.length}`);
  console.log(`updated: ${counters.updated.length}`);
  console.log(`skipped: ${counters.skipped}`);
  console.log(`warning: ${counters.warnings}`);
  if (counters.errors > 0) console.log(`error: ${counters.errors}`);
  if (counters.added.length > 0) console.log(["added:", ...counters.added.map((path) => `  ${path}`)].join("\n"));
  if (counters.updated.length > 0) console.log(["updated:", ...counters.updated.map((path) => `  ${path}`)].join("\n"));

  let code = counters.errors > 0 ? 3 : 0;
  if (!options.noIndex) {
    const indexCode = await runIndex(config);
    if (indexCode !== 0) code = indexCode;
  }
  return code;
}
