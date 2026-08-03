#!/usr/bin/env bun
// PreToolUse hook: gh コマンドで PR/Issue のコメントを投稿・更新するとき、
// 本文全体を <details><summary>🤖 Codex</summary> … </details> で
// 囲むことを強制する

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { readInput } from "./lib.ts";

const SUMMARY_LINE = "<summary>🤖 Codex</summary>";

const REASON = `GitHub の PR/Issue コメント本文は details ブロックで囲む必要があります（github-review.md ルール）。次の形式にしてください。

<details>
<summary>🤖 Codex</summary>

本文

</details>`;

const input = await readInput<{
  cwd?: string;
  tool_input?: { command?: string };
}>();
const command = input.tool_input?.command ?? "";
const cwd = input.cwd ?? process.cwd();

function allow(): never {
  process.exit(0);
}

function block(): never {
  console.log(JSON.stringify({ decision: "block", reason: REASON }));
  process.exit(0);
}

// --- 対象コマンドの判定 ---------------------------------------------------

// gh api のコメント系エンドポイント
//   pulls/comments    : review comment の更新
//   pulls/*/comments  : review comment の新規作成・返信
//   pulls/*/reviews   : review の submit
//   issues/*/comments : PR / Issue の通常コメント
const GH_API_COMMENT =
  /\bgh\s+api\b[\s\S]*?\b(?:pulls\/\d*\/?comments|pulls\/\d+\/reviews|issues\/\d+\/comments)\b/;
const GH_SUBCOMMAND_COMMENT =
  /\bgh\s+(?:pr\s+(?:comment|review)|issue\s+comment)\b/;

const isApi = GH_API_COMMENT.test(command);
if (!isApi && !GH_SUBCOMMAND_COMMENT.test(command)) {
  allow();
}

// 削除・取得は本文を伴わないため対象外
if (/(?:--method|-X)\s+(?:DELETE|GET)\b/i.test(command)) {
  allow();
}

// --- body の取得元を特定 --------------------------------------------------

// シェルの引用を考慮した値のパターン。__V__ の位置に差し込んで使う
const VALUE = String.raw`"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;|&]+)`;

function matchValue(pattern: string): string | null {
  const matched = command.match(new RegExp(pattern.replace("__V__", VALUE)));
  if (!matched) return null;
  return matched[1] ?? matched[2] ?? matched[3] ?? null;
}

type BodySource =
  | { kind: "none" }
  | { kind: "literal"; text: string }
  | { kind: "file"; path: string }
  | { kind: "jsonFile"; path: string }
  // シェル変数・コマンド置換・標準入力。この時点では中身が読めない
  | { kind: "opaque" };

function classifyPath(path: string, kind: "file" | "jsonFile"): BodySource {
  if (path === "-" || /[$`]/.test(path)) return { kind: "opaque" };
  return { kind, path };
}

function classifyValue(value: string): BodySource {
  // gh api の -F/--field は @file でファイルの内容を読み込む
  if (value.startsWith("@")) return classifyPath(value.slice(1), "file");
  if (/[$`]/.test(value)) return { kind: "opaque" };
  return { kind: "literal", text: value };
}

function detectBody(): BodySource {
  if (isApi) {
    const field = matchValue(
      String.raw`(?:^|\s)(?:-f|-F|--field|--raw-field)\s+body=(?:__V__)`,
    );
    if (field !== null) return classifyValue(field);

    const inputPath = matchValue(String.raw`(?:^|\s)--input(?:\s+|=)(?:__V__)`);
    if (inputPath !== null) return classifyPath(inputPath, "jsonFile");

    return { kind: "none" };
  }

  // gh pr comment / gh pr review / gh issue comment は -F が --body-file の短縮形
  const bodyFile = matchValue(
    String.raw`(?:^|\s)(?:--body-file|-F)(?:\s+|=)(?:__V__)`,
  );
  if (bodyFile !== null) return classifyPath(bodyFile, "file");

  const body = matchValue(String.raw`(?:^|\s)(?:--body|-b)(?:\s+|=)(?:__V__)`);
  if (body !== null) return classifyValue(body);

  return { kind: "none" };
}

// --- 判定 -----------------------------------------------------------------

async function readFileText(path: string): Promise<string | null> {
  const expanded = path.replace(/^~(?=\/|$)/, homedir());
  const file = Bun.file(
    isAbsolute(expanded) ? expanded : resolve(cwd, expanded),
  );
  return (await file.exists()) ? await file.text() : null;
}

function extractJsonBody(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { body?: unknown };
    return typeof parsed.body === "string" ? parsed.body : null;
  } catch {
    return null;
  }
}

function isWrapped(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("<details>") &&
    trimmed.endsWith("</details>") &&
    trimmed.includes(SUMMARY_LINE)
  );
}

const source = detectBody();

if (source.kind === "none") {
  allow();
}

if (source.kind === "literal") {
  if (isWrapped(source.text)) allow();
  block();
}

if (source.kind === "opaque") {
  // 展開前の値しか見えないので、コマンド全体に details ブロックが
  // 書かれているかで判定する
  if (command.includes(SUMMARY_LINE)) allow();
  block();
}

const fileText = await readFileText(source.path);
const bodyText =
  fileText === null
    ? null
    : source.kind === "jsonFile"
      ? extractJsonBody(fileText)
      : fileText;

if (bodyText !== null && isWrapped(bodyText)) {
  allow();
}

// 同じコマンド内のヒアドキュメントでこれから書き込む場合、
// ファイルはまだ存在しないか古い内容のままになる
if (command.includes(SUMMARY_LINE)) {
  allow();
}

block();
