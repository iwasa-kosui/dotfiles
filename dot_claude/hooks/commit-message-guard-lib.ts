// git commit のメッセージが `@` で始まっていないかを判定するロジック。
// hook 本体から切り離してテストできるようにしている。
//
// 組織配信の remote-settings が CLAUDE_CODE_USE_POWERSHELL_TOOL を有効にしているため、
// PowerShell ツールの説明文にある here-string `@'...'@` が zsh のコマンドに混入する。
// zsh はこれを here-string と解釈せず「リテラルの @ + シングルクォート文字列 + リテラルの @」
// として連結するので、コミットメッセージの先頭と末尾に `@` が残る。

import { GIT_PREFIX } from "./shell-hook-lib.ts";

export type CommitMessageSource =
  | { kind: "inline"; value: string }
  | { kind: "file"; path: string };

export const REASON = `コミットメッセージが \`@\` で始まっています。PowerShell の here-string \`@'...'@\` を zsh に渡した可能性があります。

zsh は \`@'...'@\` を here-string と解釈せず、リテラルの \`@\` とシングルクォート文字列の連結として扱います。そのためメッセージの先頭と末尾に \`@\` が残ります。

複数行のメッセージは一時ファイルに書いてから渡してください。

    cat > /tmp/commit-msg.txt <<'EOF'
    feat(scope): 要約

    本文
    EOF
    git commit -F /tmp/commit-msg.txt`;

// シェルの引用を考慮した値のパターン。gh-comment-format-guard.ts と同じ形。
const VALUE = String.raw`"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;|&]+)`;

// -m / --message とその値。`-am` `-sm` のような短縮フラグの連結も拾う。
// `-m@'...'` のように値が直結する形も git は受け付けるため空白を任意にしている。
const INLINE_FLAG = String.raw`(?:^|\s)(?:-(?!-)[A-Za-z]*m\s*|--message(?:\s+|=))`;
const FILE_FLAG = String.raw`(?:^|\s)(?:-(?!-)[A-Za-z]*F\s*|--file(?:\s+|=))`;

function* matchValues(command: string, flag: string): Generator<string> {
  const pattern = new RegExp(`${flag}(?:${VALUE})`, "g");
  for (const matched of command.matchAll(pattern)) {
    const value = matched[1] ?? matched[2] ?? matched[3];
    if (value !== undefined) yield value;
  }
}

export function extractCommitMessageSources(
  command: string,
): CommitMessageSource[] {
  // commit-tree / commit-graph は別コマンドなので除外する
  const commitPattern = new RegExp(`${GIT_PREFIX.source}commit(?![-\\w])`);
  if (!commitPattern.test(command)) return [];

  const sources: CommitMessageSource[] = [];
  for (const value of matchValues(command, INLINE_FLAG)) {
    sources.push({ kind: "inline", value });
  }
  for (const path of matchValues(command, FILE_FLAG)) {
    // `-F -` は標準入力。この時点では中身が読めない
    if (path === "-") continue;
    sources.push({ kind: "file", path });
  }
  return sources;
}

export function startsWithAtSign(text: string): boolean {
  return /^\s*@/.test(text);
}
