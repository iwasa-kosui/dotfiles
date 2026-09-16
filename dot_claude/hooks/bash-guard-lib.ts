// executable_bash-guard.ts が順に実行するガードの一覧。
// 各 guard lib の check 関数は ./guard-lib.ts の GuardInput を受け取り GuardResult を返す。

import { checkAwsCli } from "./aws-cli-guard-lib.ts";
import { checkMainBranchGuard } from "./branch-guard-lib.ts";
import { checkCommitMessage } from "./commit-message-guard-lib.ts";
import { checkForcePush } from "./force-push-guard-lib.ts";
import { checkGhCommentFormat } from "./gh-comment-format-guard-lib.ts";
import type { Guard } from "./guard-lib.ts";
import { checkOutgoingBody } from "./lint-outgoing-body-lib.ts";
import { checkPrDelegation } from "./pr-delegation-guard-lib.ts";

// executable_bash-guard.ts が逐次実行する順序。
// dot_claude/modify_settings.json.tmpl の旧6件登録の順序をそのまま引き継ぐ。
export const guards: readonly Guard[] = [
  {
    name: "main-branch-guard",
    // branch-guard-lib.ts は dot_claude/ dot_codex/ dot_cursor/ の3拠点同期対象なので
    // GuardInput を受け取る形に変更せず、ここで (command, cwd) に詰め替えるアダプタを書く。
    check: (input) => checkMainBranchGuard(input.normalizedCommand, input.cwd),
  },
  { name: "force-push-guard", check: checkForcePush },
  { name: "commit-message-guard", check: checkCommitMessage },
  { name: "gh-comment-format-guard", check: checkGhCommentFormat },
  { name: "lint-outgoing-body", check: checkOutgoingBody },
  { name: "pr-delegation-guard", check: checkPrDelegation },
  { name: "aws-cli-guard", check: checkAwsCli },
];
