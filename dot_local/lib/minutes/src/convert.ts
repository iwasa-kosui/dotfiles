import { basename } from "node:path";
import { ExternalError } from "./errors.ts";
import { run } from "./external.ts";

export type Kind = "notes" | "transcript" | "chat";

export type SourceMeta = {
  key: string;
  title: string;
  date: string;
  kind: Kind;
  source: string;
  copy: string;
};

const untitled = "無題の会議";
const jstDate = /(\d{4})_(\d{2})_(\d{2}) (\d{2})_(\d{2}) JST/;
const gmtDate = /\((\d{4})-(\d{2})-(\d{2}) (\d{2})_(\d{2}) GMT\+9\)/;

export function isTargetFile(fileName: string): boolean {
  const name = fileName.normalize("NFC");
  if (name.startsWith("~$")) return false;
  return /\.docx$/i.test(name) || /～Chat\s*(?:\(\d+\))?\.txt$/.test(name) || isGmtChatName(name);
}

function isGmtChatName(name: string): boolean {
  return /\.txt$/i.test(name) && gmtDate.test(name);
}

export function parseFileName(fileName: string): SourceMeta | null {
  const name = fileName.normalize("NFC");
  const dot = name.lastIndexOf(".");
  const fullStem = dot < 0 ? name : name.slice(0, dot);
  const copyMatch = /\s*\((\d+)\)$/.exec(fullStem);
  const stem = copyMatch ? fullStem.slice(0, copyMatch.index) : fullStem;

  let kind: Kind | null = null;
  if (stem.endsWith("Chat")) kind = "chat";
  else if (stem.endsWith("Gemini によるメモ")) kind = "notes";
  else if (stem.endsWith("Transcript")) kind = "transcript";
  else if (isGmtChatName(name)) kind = "chat";
  if (!kind) return null;

  const match = jstDate.exec(stem) ?? gmtDate.exec(stem);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;

  const title = stem.slice(0, match.index).replace(/(?:\s+-)?\s*$/, "");
  return {
    key: fullStem,
    title: title || untitled,
    date: `${year}-${month}-${day}T${hour}:${minute}:00+09:00`,
    kind,
    source: fileName,
    copy: copyMatch ? ` (${copyMatch[1]})` : "",
  };
}

export function outputRelPath(meta: SourceMeta): string {
  const year = meta.date.slice(0, 4);
  const day = meta.date.slice(0, 10);
  const time = meta.date.slice(11, 16).replace(":", "");
  const title = meta.title.replaceAll("/", "／").replaceAll(":", "：");
  return `${year}/${day} ${time} ${title} - ${meta.kind}${meta.copy}.md`;
}

const japanese = "[\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF、。ー]";
const japaneseGap = new RegExp(`(?<=${japanese}) +(?=${japanese})`, "g");

export function postprocess(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(
      /\(\[<u>(\d{1,2}:\d{2}:\d{2})<\/u>\]\([^)]*\)\)|\[<u>(\d{1,2}:\d{2}:\d{2})<\/u>\]\([^)]*\)/g,
      (_, inner: string | undefined, bare: string | undefined) => `(${inner ?? bare})`,
    )
    .replace(/\[<u>([^<]*)<\/u>\]\(mailto:[^)]*\)/g, "$1")
    .replace(/<u>([\s\S]*?)<\/u>/g, "$1")
    .replace(japaneseGap, "");
}

export async function pandocToMarkdown(file: string): Promise<string> {
  const result = await run(["pandoc", "-f", "docx", "-t", "gfm", "--wrap=none", file]);
  if (result.exitCode !== 0) {
    throw new ExternalError(`pandoc が失敗しました (${basename(file)}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}
