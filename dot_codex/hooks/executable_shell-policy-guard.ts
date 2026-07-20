#!/usr/bin/env bun
// PreToolUse hook: Claude の deny 設定相当の危険な Bash 操作をブロック

import { readInput } from "./lib.ts";

const input = await readInput<{ tool_input?: { command?: string } }>();
const command = input.tool_input?.command ?? "";
const normalizedCommand = command.replace(/\s+/g, " ").trim();

if (!normalizedCommand) {
  process.exit(0);
}

type DenyRule = {
  pattern: RegExp;
  reason: string;
};

const denyRules: DenyRule[] = [
  {
    pattern: /\b(chmod\s+777\s+\/|rm\s+-rf\s+\/|rm\s+-rf\s+\/\*|dd|mkfs|format|halt|reboot|shutdown|sudo|su|systemctl|service|nc)\b/,
    reason: "システム破壊・権限昇格・低レベル操作はブロックされています。",
  },
  {
    pattern: /\b(curl|wget)\b/,
    reason: "curl/wget による直接ネットワーク取得はブロックされています。必要なら、手順書を作成してユーザーに実行させてください。"
  },
  {
    pattern: /\bdocker\s+run\b.*\s--privileged\b|\bdocker\s+system\s+prune\b/,
    reason: "危険な Docker 操作はブロックされています。",
  },
  {
    pattern: /\bgh\s+(auth\s+token|repo\s+delete)\b|\bgh\s+api\b.*(-X|--method)\s+DELETE\b/,
    reason: "GitHub token 表示・リポジトリ削除・DELETE API はブロックされています。",
  },
  {
    pattern: /\bgit\s+(clean\s+-(f|fd|fdx|fx)\b|reset\s+--hard\b)/,
    reason: "破壊的な git 操作はブロックされています。",
  },
  {
    pattern: /\bnpm\s+publish\b/,
    reason: "npm publish はブロックされています。",
  },
  {
    pattern: /\b(confluence\s+config|pup\s+(data-deletion|api-keys|app-keys|users\s+service-accounts|monitors\s+delete|dashboards\s+delete|slos\s+delete|obs-pipelines|cloud|integrations|workflows|runbooks\s+run|fleet|on-call|downtime\s+cancel|investigations\s+trigger|logs-restriction|security\s+rules|debugger\s+probes|tags|scorecards|static-analysis|change-requests|cases|app-builder|status-pages|product-analytics\s+events\s+send|llm-obs|reference-tables|datasets|idp\s+register|hamr\s+connections\s+create|incidents|acp\s+serve))\b/,
    reason: "外部サービスの作成・更新・削除系 CLI 操作はブロックされています。",
  },
  {
    pattern: /\b(cat|head|tail|less|more|grep|sed|awk|source)\s+[^;&|]*((~|\$HOME)\/\.zshrc_local|(~|\$HOME)\/\.aws|(~|\$HOME)\/\.ssh|(~|\$HOME)\/\.gnupg|(~|\$HOME)\/\.npmrc|(~|\$HOME)\/\.netrc|(~|\$HOME)\/\.docker\/config\.json|(~|\$HOME)\/\.kube|(~|\$HOME)\/\.config\/gh\/hosts\.yml|(~|\$HOME)\/\.config\/confluence-cli|(~|\$HOME)\/\.config\/jira-cli|(~|\$HOME)\/\.env)/,
    reason: "秘密情報ファイルを表示・検索・source する操作はブロックされています。",
  },
];

const matchedRule = denyRules.find(({ pattern }) =>
  pattern.test(normalizedCommand),
);

if (!matchedRule) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason: matchedRule.reason,
  }),
);
