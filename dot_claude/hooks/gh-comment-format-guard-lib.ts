// gh コマンドで PR/Issue のコメントを投稿・更新するとき、エージェントの発言を
// `> 🤖 Claude Code` の署名行以降、引用記法で囲むことを強制する判定ロジック。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { allow, deny, type GuardInput, type GuardResult } from "./guard-lib.ts";

const SIGNATURE_LINE = "> 🤖 Claude Code";

export const REASON = `GitHub の PR/Issue コメント本文は、エージェントの発言を引用記法で囲む必要があります。次の形式にしてください。

> 🤖 Claude Code
>
> 修正しました (e4dcbb406)

\`> 🤖 Claude Code\` の行以降は、空行を含めてすべて行頭を \`>\` にします。署名行より上は引用の外に置けるので、ユーザーの追記はそこに入ります。`;

// --- 対象コマンドの判定 ---------------------------------------------------

// gh api のコメント系エンドポイント
//   pulls/comments    : review comment の更新
//   pulls/*/comments  : review comment の新規作成・返信
//   pulls/*/reviews   : review の submit
//   issues/*/comments : PR / Issue の通常コメント
export const GH_API_COMMENT =
  /\bgh\s+api\b[\s\S]*?\b(?:pulls\/\d*\/?comments|pulls\/\d+\/reviews|issues\/\d+\/comments)\b/;
export const GH_SUBCOMMAND_COMMENT =
  /\bgh\s+(?:pr\s+(?:comment|review)|issue\s+comment)\b/;

// --- body の取得元を特定 --------------------------------------------------

// シェルの引用を考慮した値のパターン。__V__ の位置に差し込んで使う
const VALUE = String.raw`"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;|&]+)`;

export function matchValue(command: string, pattern: string): string | null {
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

export function detectBody(command: string, isApi: boolean): BodySource {
  if (isApi) {
    const field = matchValue(
      command,
      String.raw`(?:^|\s)(?:-f|-F|--field|--raw-field)\s+body=(?:__V__)`,
    );
    if (field !== null) return classifyValue(field);

    const inputPath = matchValue(
      command,
      String.raw`(?:^|\s)--input(?:\s+|=)(?:__V__)`,
    );
    if (inputPath !== null) return classifyPath(inputPath, "jsonFile");

    return { kind: "none" };
  }

  // gh pr comment / gh pr review / gh issue comment は -F が --body-file の短縮形
  const bodyFile = matchValue(
    command,
    String.raw`(?:^|\s)(?:--body-file|-F)(?:\s+|=)(?:__V__)`,
  );
  if (bodyFile !== null) return classifyPath(bodyFile, "file");

  const body = matchValue(
    command,
    String.raw`(?:^|\s)(?:--body|-b)(?:\s+|=)(?:__V__)`,
  );
  if (body !== null) return classifyValue(body);

  return { kind: "none" };
}

// --- 判定 -----------------------------------------------------------------

export function readFileText(path: string, cwd: string): string | null {
  const expanded = path.replace(/^~(?=\/|$)/, homedir());
  const resolved = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  return existsSync(resolved) ? readFileSync(resolved, "utf8") : null;
}

function extractJsonBody(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { body?: unknown };
    return typeof parsed.body === "string" ? parsed.body : null;
  } catch {
    return null;
  }
}

export function isQuoted(text: string): boolean {
  const lines = text.split("\n");
  const signatureIndex = lines.findIndex(
    (line) => line.trim() === SIGNATURE_LINE,
  );
  if (signatureIndex === -1) return false;

  return lines.slice(signatureIndex).every((line) => {
    const trimmed = line.trim();
    return trimmed === "" || trimmed.startsWith(">");
  });
}

export function checkGhCommentFormat(input: GuardInput): GuardResult {
  // isQuoted は body 内の改行で行頭を判定するため、正規化前の生のコマンドを使う。
  // 正規化すると改行が空白に潰れ、判定が反転する。
  const { command, cwd } = input;

  const isApi = GH_API_COMMENT.test(command);
  if (!isApi && !GH_SUBCOMMAND_COMMENT.test(command)) {
    return allow;
  }

  // 削除・取得は本文を伴わないため対象外
  if (/(?:--method|-X)\s+(?:DELETE|GET)\b/i.test(command)) {
    return allow;
  }

  const source = detectBody(command, isApi);

  if (source.kind === "none") {
    return allow;
  }

  if (source.kind === "literal") {
    return isQuoted(source.text) ? allow : deny(REASON);
  }

  if (source.kind === "opaque") {
    // 展開前の値しか見えないので、コマンド全体に署名行が
    // 書かれているかで判定する
    return command.includes(SIGNATURE_LINE) ? allow : deny(REASON);
  }

  const fileText = readFileText(source.path, cwd);
  const bodyText =
    fileText === null
      ? null
      : source.kind === "jsonFile"
        ? extractJsonBody(fileText)
        : fileText;

  if (bodyText !== null && isQuoted(bodyText)) {
    return allow;
  }

  // 同じコマンド内のヒアドキュメントでこれから書き込む場合、
  // ファイルはまだ存在しないか古い内容のままになる
  if (command.includes(SIGNATURE_LINE)) {
    return allow;
  }

  return deny(REASON);
}
