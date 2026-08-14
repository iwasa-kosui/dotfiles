#!/usr/bin/env bun
// PreToolUse hook: PR・Confluence・Jira へ本文を送る直前に textlint にかける。
//
// 判断基準は ~/.claude/rules/communication-style.md、検査語彙は
// ~/.claude/textlint-rules/no-prohibited-expression.js。
//
// 想定外のエラーでは通す。品質ゲートであってセキュリティ境界ではないため、
// スクリプトの不具合で送信が不能になる方が損失が大きい。

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { readInput } from "./lib.ts";

const CLAUDE_DIR = join(homedir(), ".claude");

type FlagKind = "file" | "inline";
type Flag = { name: string; kind: FlagKind };

// file はパスを渡すフラグ、inline は本文を直接書くフラグ。フラグ名は各 CLI の --help で確認したもの。
// 長い名前を先に見る必要があるのは、--body が --body-file に部分一致するため。
const BODY_FLAGS: Flag[] = [
  { name: "--body-file", kind: "file" },
  { name: "-B", kind: "file" },
  { name: "--body", kind: "inline" },
  { name: "-b", kind: "inline" },
];

const TARGETS: { re: RegExp; label: string; flags: Flag[] }[] = [
  {
    re: /\bgh\s+pr\s+(create|edit)\b/,
    label: "PR の送信",
    // gh の -B は --base なので、file フラグは -F だけ。
    flags: [
      { name: "--body-file", kind: "file" },
      { name: "-F", kind: "file" },
      { name: "--body", kind: "inline" },
      { name: "-b", kind: "inline" },
    ],
  },
  { re: /\bconfluence\s+(create|edit)\b/, label: "Confluence への送信", flags: BODY_FLAGS },
  {
    re: /\bjira\s+(create|edit)\b/,
    label: "Jira への送信",
    flags: [
      { name: "--description-file", kind: "file" },
      { name: "-D", kind: "file" },
      { name: "--description", kind: "inline" },
      { name: "-d", kind: "inline" },
    ],
  },
  { re: /\bjira\s+comment\s+add\b/, label: "Jira コメントの送信", flags: BODY_FLAGS },
];

const HEREDOC = /([^\n]*)<<-?\s*(['"]?)(\w+)\2([^\n]*)\r?\n([\s\S]*?)\r?\n\3(?=\s|$)/g;

// PreToolUse はトップレベルの decision ではなく hookSpecificOutput.permissionDecision を読む。
// 何も出力せず終了した場合は通常のパーミッションフローに委ねられる。
function deny(reason: string): never {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/**
 * ヒアドキュメントを解析する。本文はコマンドではないので判定用の文字列から取り除く。
 * 取り除かないと、本文に説明として書いたコマンドを実行対象と誤認する。
 *
 * 同時に書き出し先と本文の対応を集める。書き出しと送信を1つのコマンドにまとめた場合、
 * hook が動く時点でファイルはまだ存在しないため、この本文を検査する必要がある。
 */
function parseHeredocs(command: string, cwd: string) {
  const bodies = new Map<string, string>();
  for (const [, prefix, , , suffix, body] of command.matchAll(HEREDOC)) {
    const target = /(?:^|\s)>>?\s*(\S+)/.exec(`${prefix} ${suffix}`);
    if (target) bodies.set(toAbsolute(target[1], cwd), body);
  }
  const stripped = command.replace(HEREDOC, (_m, prefix, _q, _d, suffix) => `${prefix} ${suffix}`);
  return { bodies, stripped };
}

function toAbsolute(path: string, cwd: string): string {
  const expanded = path.replace(/^~(?=\/|$)/, homedir());
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

/**
 * フラグの値を取り出す。引用符で囲まれた値はスペースを含みうるので引用の種類ごとに見る。
 * フラグが無い場合は undefined、あるが取り出せない場合は null を返す。
 */
function extractFlagValue(command: string, flag: string): string | null | undefined {
  if (!new RegExp(`${flag}(?:=|\\s)`).test(command)) return undefined;
  const m = new RegExp(`${flag}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(command);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

type Resolved =
  | { label: string; text: string; blockedReason?: undefined }
  | { label: string; blockedReason: string; text?: undefined };

/** 送信される本文を特定する。対象外なら null を返す。 */
async function resolveBody(
  command: string,
  bodies: Map<string, string>,
  cwd: string,
): Promise<Resolved | null> {
  for (const { re, label, flags } of TARGETS) {
    if (!re.test(command)) continue;

    for (const { name, kind } of flags) {
      const value = extractFlagValue(command, name);
      if (value === undefined) continue;

      if (value === null || /\$\(|`/.test(value)) {
        return {
          label,
          blockedReason:
            "本文がコマンド置換で渡されているため、送信される内容を検査できません。一時ファイルに書き出してから送信してください。",
        };
      }
      if (value === "-") {
        return {
          label,
          blockedReason:
            "本文が標準入力から渡されているため検査できません。一時ファイルに書き出してから送信してください。",
        };
      }
      if (kind === "inline") return { label, text: value };

      const path = toAbsolute(value, cwd);
      const heredoc = bodies.get(path);
      if (heredoc !== undefined) return { label, text: heredoc };

      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`>>?\\s*${escaped}`).test(command)) {
        return {
          label,
          blockedReason: `${value} を同じコマンド内で書き出していますが、送信される内容を特定できません。ヒアドキュメントで書き出すか、書き出しと送信を別のコマンドに分けてください。`,
        };
      }
      const file = Bun.file(path);
      if (!(await file.exists())) {
        return { label, blockedReason: `${value} が存在しません。パスを確認してください。` };
      }
      return { label, text: await file.text() };
    }

    // 本文を渡していない操作。タイトルやラベルの変更だけなので対象外。
    return null;
  }
  return null;
}

/** textlint に本文を流す。指摘があればその出力を返し、なければ null を返す。 */
async function lint(text: string): Promise<string | null> {
  const bin = join(CLAUDE_DIR, "node_modules", ".bin", "textlint");
  if (!(await Bun.file(bin).exists())) {
    console.error(
      "textlint が見つかりません。~/.claude で bun install を実行するか chezmoi apply してください。",
    );
    return null;
  }
  const proc = Bun.spawn(
    [
      bin,
      "--config",
      join(CLAUDE_DIR, ".textlintrc.json"),
      "--rulesdir",
      join(CLAUDE_DIR, "textlint-rules"),
      "--stdin",
      "--stdin-filename",
      "outgoing-body.md",
    ],
    { cwd: CLAUDE_DIR, stdin: new Blob([text]), stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  // 指摘があると終了コードが1になり、内容は stdout に出る。
  const exitCode = await proc.exited;
  if (exitCode === 0) return null;
  return stdout.trim() || null;
}

async function main() {
  const input = await readInput<{ cwd?: string; tool_input?: { command?: string } }>();
  const raw = input.tool_input?.command ?? "";
  if (!raw) return;

  const cwd = input.cwd ?? process.cwd();
  const { bodies, stripped } = parseHeredocs(raw, cwd);
  const resolved = await resolveBody(stripped, bodies, cwd);
  if (!resolved) return;

  const reason = resolved.blockedReason ?? (await lint(resolved.text));
  if (!reason) return;

  deny(
    `${resolved.label} を止めました。\n\n${reason}\n\n判断基準は ~/.claude/rules/communication-style.md です。`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`lint-outgoing-body hook: ${(error as Error).message}`);
  process.exit(0);
}
