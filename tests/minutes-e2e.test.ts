import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const bin = resolve(import.meta.dir, "../dot_local/bin/executable_minutes");
const chatName = "認証ポータルUI相談 - 2025_09_29 15_29 JST～Chat.txt";
const hasPandoc = Bun.which("pandoc") !== null;

function vectorOf(text: string): number[] {
  const v = new Array(64).fill(0);
  for (const char of text) v[char.codePointAt(0)! % 64] += 1;
  return v;
}

let dir: string;
let server: ReturnType<typeof Bun.serve>;
let env: Record<string, string>;

async function minutes(args: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, bin, ...args], { env: { ...env, ...extraEnv }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "minutes-e2e-"));
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { input: string[] };
      return Response.json({ embeddings: body.input.map(vectorOf) });
    },
  });
  env = {
    ...(process.env as Record<string, string>),
    MINUTES_DIR: join(dir, "md"),
    XDG_DATA_HOME: join(dir, "data"),
    OLLAMA_HOST: `http://127.0.0.1:${server.port}`,
  };
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

describe("minutes CLI", () => {
  const inbox = () => join(dir, "inbox");

  test("--help は usage を出して 0 で終わる", async () => {
    const result = await minutes(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("minutes");
  });

  test("不明なコマンドと存在しないパスは 2", async () => {
    expect((await minutes(["nope"])).code).toBe(2);
    expect((await minutes(["ingest", join(dir, "missing")])).code).toBe(2);
    expect((await minutes(["search"])).code).toBe(2);
    expect((await minutes(["search", "abc", "--kind", "x"])).code).toBe(2);
  });

  test("ingest が Chat.txt を取り込み、再実行では skipped、変更すると updated になる", async () => {
    mkdirSync(inbox(), { recursive: true });
    writeFileSync(join(inbox(), chatName), "田中: 結びの件を確認します\n鈴木: 認証ポータルの設計書を共有します\n");
    writeFileSync(join(inbox(), "recording～Recording.mp4"), "binary");
    mkdirSync(join(dir, "md"), { recursive: true });
    writeFileSync(join(dir, "md", "typos.tsv"), "結び\tMusubi\n");

    const first = await minutes(["ingest", inbox()]);
    expect(first.code, first.err).toBe(0);
    expect(first.out).toContain("added: 1");
    const md = join(dir, "md/2025/2025-09-29 1529 認証ポータルUI相談 - chat.md");
    expect(existsSync(md)).toBe(true);
    expect(readFileSync(md, "utf8")).toContain("Musubiの件");
    expect(readFileSync(join(dir, "data/minutes/raw/2025/2025-09-29 1529 認証ポータルUI相談 - chat.md"), "utf8")).toContain("結びの件");
    expect(readFileSync(md, "utf8")).toContain('kind: "chat"');
    expect(existsSync(join(inbox(), "recording～Recording.mp4"))).toBe(true);

    const second = await minutes(["ingest", inbox()]);
    expect(second.out).toContain("skipped: 1");
    expect(second.out).toContain("added: 0");

    writeFileSync(join(inbox(), chatName), "田中: 内容を差し替えました\n");
    const third = await minutes(["ingest", inbox()]);
    expect(third.out).toContain("updated: 1");
  });

  test("search が全文検索とベクトル検索を統合して返す", async () => {
    writeFileSync(join(inbox(), chatName), "田中: 結びの件を確認します\n鈴木: 認証ポータルの設計書を共有します\n");
    expect((await minutes(["ingest", inbox()])).code).toBe(0);

    const result = await minutes(["search", "認証ポータル", "--json"]);
    expect(result.code, result.err).toBe(0);
    const hits = JSON.parse(result.out);
    expect(hits[0].title).toBe("認証ポータルUI相談");
    expect(hits[0].kind).toBe("chat");
    expect(hits[0].path).toBe(join(dir, "md/2025/2025-09-29 1529 認証ポータルUI相談 - chat.md"));
    expect(hits[0].text).toContain("認証ポータルの設計書");

    const text = await minutes(["search", "認証ポータル"]);
    expect(text.out).toContain("2025-09-29");
    expect(text.out).toContain(":8");

    expect((await minutes(["search", "認証ポータル", "--since", "2026-01-01"])).code).toBe(1);
    expect((await minutes(["search", "認証ポータル", "--kind", "notes"])).out).toContain("該当なし");
    expect((await minutes(["search", "認証ポータル", "--until", "2025-12-31", "--kind", "chat"])).code).toBe(0);
  });

  test("retypo が辞書の変更を Markdown に反映する", async () => {
    writeFileSync(join(dir, "md", "typos.tsv"), "認証ポータル\t認証Portal\n");
    const result = await minutes(["retypo"]);
    expect(result.code, result.err).toBe(0);
    const md = readFileSync(join(dir, "md/2025/2025-09-29 1529 認証ポータルUI相談 - chat.md"), "utf8");
    expect(md).toContain("認証Portalの設計書");
    expect(md).not.toContain("Musubi");
  });

  test("status が件数とパスを表示する", async () => {
    const result = await minutes(["status"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("取り込み済み: 1 件 (chat: 1)");
    expect(result.out).toContain("埋め込み未作成: 0");
  });

  test("重複番号つきの別ファイルは別の文書として取り込む", async () => {
    const copies = join(dir, "copies");
    mkdirSync(copies, { recursive: true });
    writeFileSync(join(copies, "会議A - 2026_01_02 03_04 JST～Chat.txt"), "田中: 一つ目\n");
    writeFileSync(join(copies, "会議A - 2026_01_02 03_04 JST～Chat(1).txt"), "田中: 二つ目\n");
    const result = await minutes(["ingest", copies, "--no-index"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("added: 2");
    expect(readFileSync(join(dir, "md/2026/2026-01-02 0304 会議A - chat.md"), "utf8")).toContain("一つ目");
    expect(readFileSync(join(dir, "md/2026/2026-01-02 0304 会議A - chat (1).md"), "utf8")).toContain("二つ目");
  });

  test("Chat.txt 以外の名前のチャット記録を取り込み、出力先が衝突する別ファイルは警告してスキップする", async () => {
    const chats = join(dir, "chats");
    mkdirSync(chats, { recursive: true });
    const body = "00:05:18.736,00:05:21.736\n田中: こんにちは\n";
    writeFileSync(join(chats, "[要録画]デモ2 (2024-04-22 10_32 GMT+9).txt"), body);
    writeFileSync(join(chats, "デモ2 - 2024_04_22 10_32 JST～Chat.txt"), "a\n");
    const result = await minutes(["ingest", chats, "--no-index"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("added: 2");
    const md = readFileSync(join(dir, "md/2024/2024-04-22 1032 [要録画]デモ2 - chat.md"), "utf8");
    expect(md).toContain(body);

    const clash = join(dir, "clash");
    mkdirSync(clash, { recursive: true });
    writeFileSync(join(clash, "[要録画]デモ2 - 2024_04_22 10_32 JST～Chat.txt"), "別の本文\n");
    const second = await minutes(["ingest", clash, "--no-index"]);
    expect(second.code, second.err).toBe(0);
    expect(second.err).toContain("警告");
    expect(second.out).toContain("warning: 1");
    expect(second.out).toContain("added: 0");
    expect(readFileSync(join(dir, "md/2024/2024-04-22 1032 [要録画]デモ2 - chat.md"), "utf8")).toContain(body);
  });

  test("ollama に接続できない場合は index が 3 で終わり ollama pull を案内する", async () => {
    writeFileSync(join(dir, "md", "extra.md"), "追加の本文\n");
    const result = await minutes(["index"], { OLLAMA_HOST: "http://127.0.0.1:1" });
    expect(result.code).toBe(3);
    expect(result.err).toContain("ollama pull bge-m3");
  });

  test.skipIf(!hasPandoc)("zip 内の docx を pandoc で変換し、--delete-source で zip だけ消える", async () => {
    const work = join(dir, "zip");
    mkdirSync(work, { recursive: true });
    const docxName = "週次定例 - 2026_10_16 16_30 JST - Gemini によるメモ.docx";
    const md = join(work, "src.md");
    writeFileSync(md, "### 概要\n\n概要の本文です。\n\n### 詳細\n\n- 項目A: 説明A\n- 項目B: 説明B\n");
    const stage = join(work, "stage");
    mkdirSync(stage);
    expect(Bun.spawnSync(["pandoc", md, "-o", join(stage, docxName)]).exitCode).toBe(0);
    writeFileSync(join(stage, "週次定例～Recording.mp4"), "binary");
    const zip = join(work, "meet.zip");
    expect(Bun.spawnSync(["ditto", "-c", "-k", stage, zip]).exitCode).toBe(0);

    const result = await minutes(["ingest", zip, "--delete-source", "--no-index"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("added: 1");
    expect(existsSync(zip)).toBe(false);
    const out = readFileSync(join(dir, "md/2026/2026-10-16 1630 週次定例 - notes.md"), "utf8");
    expect(out).toContain("### 概要");
    expect(out).toContain('date: "2026-10-16T16:30:00+09:00"');
  });
});
