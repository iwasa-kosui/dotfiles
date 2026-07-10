#!/usr/bin/env bun
// PreToolUse hook: 秘密情報ファイルの読み書きをブロック

import { readInput } from "./lib.ts";
import { homedir } from "node:os";

const input = await readInput<{
  tool_input?: {
    file_path?: string;
    path?: string;
  };
}>();

const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
if (!filePath) {
  process.exit(0);
}

const expandedPath = filePath
  .replace(/^\$HOME(?=\/|$)/, homedir())
  .replace(/^~(?=\/|$)/, homedir());
const normalizedPath = expandedPath.replaceAll("\\", "/").toLowerCase();

const blockedPathPatterns = [
  /(^|\/)\.env($|\.|\/)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.kube(\/|$)/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.config\/gh\/hosts\.yml$/,
  /(^|\/)\.config\/confluence-cli(\/|$)/,
  /(^|\/)\.config\/jira-cli(\/|$)/,
  /(^|\/)\.local\/state(\/|$)/,
  /(^|\/)\.zshrc_local$/,
  /credential/,
  /secret/,
  /password/,
  /(^|\/)[^/]*_token[^/]*$/,
  /(^|\/)[^/]*_apikey[^/]*$/,
  /(^|\/)[^/]*api_key[^/]*$/,
  /(^|\/)[^/]*id_rsa[^/]*$/,
  /(^|\/)[^/]*id_ed25519[^/]*$/,
  /(^|\/)[^/]*id_ecdsa[^/]*$/,
  /(^|\/)[^/]*id_dsa[^/]*$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /\.keystore$/,
];

if (!blockedPathPatterns.some((pattern) => pattern.test(normalizedPath))) {
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason: `秘密情報の可能性があるファイルへのアクセスはブロックされています: ${filePath}`,
  }),
);
