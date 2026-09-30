// PreToolUse hook: 保護ブランチ（main / master / develop）宛の git push をブロックする判定ロジック。
// refspec の宛先が保護ブランチのケース、refspec 省略時に現在のブランチが保護ブランチのケース、
// --delete で保護ブランチを消すケース、--all / --mirror で保護ブランチを巻き込みうるケースを検出する。メイン・サブエージェントの区別なく効かせる。

import { allow, deny, type GuardInput, type GuardResult } from "./guard-lib.ts";
import { runSafe } from "./lib.ts";
import { GIT_PREFIX, isProtectedBranch } from "./shell-hook-lib.ts";

// 値を別トークンで取る git push のオプション。値を refspec と取り違えないよう読み飛ばす。
const OPTIONS_WITH_VALUE = new Set([
  "-o",
  "--push-option",
  "--repo",
  "--receive-pack",
  "--exec",
]);

function stripQuotes(token: string): string {
  return token.replace(/^(["'])(.*)\1$/, "$2");
}

function stripHeadsPrefix(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

type PushArgs = {
  readonly refspecs: readonly string[];
  readonly isDelete: boolean;
  readonly isTagsOnly: boolean;
  readonly isBulk: boolean;
};

function parsePushArgs(tokens: readonly string[]): PushArgs {
  const positional: string[] = [];
  let isDelete = false;
  let hasTags = false;
  let isBulk = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--delete" || /^-[A-Za-z]*d[A-Za-z]*$/.test(token)) {
      isDelete = true;
      continue;
    }
    if (token === "--tags") {
      hasTags = true;
      continue;
    }
    if (token === "--all" || token === "--branches" || token === "--mirror") {
      isBulk = true;
      continue;
    }
    if (OPTIONS_WITH_VALUE.has(token)) {
      i++;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    positional.push(token);
  }

  // 先頭の positional は remote。残りが refspec。
  const refspecs = positional.slice(1);
  return {
    refspecs,
    isDelete,
    isTagsOnly: hasTags && refspecs.length === 0,
    isBulk,
  };
}

// refspec の宛先ブランチ名を返す。HEAD は現在のブランチに解決するため undefined を返す。
function destinationOf(refspec: string): string | undefined {
  const spec = refspec.replace(/^\+/, "");
  const colon = spec.indexOf(":");
  const dest = colon === -1 ? spec : spec.slice(colon + 1) || spec.slice(0, colon);
  const branch = stripHeadsPrefix(dest);
  return branch === "HEAD" ? undefined : branch;
}

async function currentBranch(cwd: string): Promise<string | null> {
  return runSafe(["git", "symbolic-ref", "--short", "-q", "HEAD"], { cwd });
}

function reasonFor(branch: string): string {
  return `保護ブランチ(${branch})への git push（削除を含む）は禁止されています。作業ブランチに push し、Draft PR 経由で反映してください。`;
}

const BULK_PUSH_REASON =
  "git push --all / --mirror は保護ブランチ（main / master / develop）を含みうるため禁止されています。作業ブランチを個別に指定して push してください。";

export async function checkProtectedBranchPush(
  input: GuardInput,
): Promise<GuardResult> {
  // パターンマッチのみなので正規化済みのコマンドを使う。
  const command = input.normalizedCommand;
  const pushPattern = new RegExp(`${GIT_PREFIX.source}push\\b`, "g");

  for (const match of command.matchAll(pushPattern)) {
    // git push を含むセグメントの範囲だけを見る（&& や ; の後の別コマンドを誤検出しない）
    const segment = command.slice(match.index + match[0].length).split(/[;&|]/)[0];
    const tokens = segment.split(" ").filter(Boolean).map(stripQuotes);
    const { refspecs, isTagsOnly, isBulk } = parsePushArgs(tokens);

    if (isBulk) {
      return deny(BULK_PUSH_REASON);
    }

    if (isTagsOnly) {
      continue;
    }

    if (refspecs.length === 0) {
      const branch = await currentBranch(input.cwd);
      if (branch && isProtectedBranch(branch)) {
        return deny(reasonFor(branch));
      }
      continue;
    }

    for (const refspec of refspecs) {
      const dest = destinationOf(refspec) ?? (await currentBranch(input.cwd));
      if (dest && isProtectedBranch(dest)) {
        return deny(reasonFor(dest));
      }
    }
  }

  return allow;
}
