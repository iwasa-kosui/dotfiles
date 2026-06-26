#!/usr/bin/env bun
// beforeReadFile / preToolUse hook: 秘密情報ファイルへのアクセスをブロック

import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

import { readInput } from "./lib.ts";

type ToolInput = {
  file_path?: string;
  path?: string;
  target_file?: string;
  old_file_path?: string;
  target_notebook?: string;
};

type HookInput = {
  file_path?: string;
  tool_input?: ToolInput;
  cwd?: string;
};

const SENSITIVE_DIR_PREFIXES = [
  `${homedir()}/.aws/`,
  `${homedir()}/.ssh/`,
  `${homedir()}/.gnupg/`,
  `${homedir()}/.kube/`,
];

const SENSITIVE_HOME_FILES = [
  `${homedir()}/.npmrc`,
  `${homedir()}/.netrc`,
  `${homedir()}/.docker/config.json`,
  `${homedir()}/.config/gh/hosts.yml`,
];

function matchesPattern(filePath: string, pattern: string): boolean {
  const name = basename(filePath);
  const regex = new RegExp(
    "^" +
      pattern
        .replaceAll(".", "\\.")
        .replaceAll("**", ".*")
        .replaceAll("*", "[^/]*") +
      "$",
  );
  return regex.test(name) || regex.test(filePath);
}

function isSensitivePath(rawPath: string, cwd: string): boolean {
  const filePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);

  const name = basename(filePath);
  const lowerName = name.toLowerCase();

  if (name === ".env" || name.startsWith(".env.")) {
    return true;
  }

  const sensitiveNamePatterns = [
    ".*credential.*",
    ".*secret.*",
    ".*password.*",
    ".*apikey.*",
    ".*api_key.*",
    ".*_token.*",
    ".*\\.pem$",
    ".*\\.p12$",
    ".*\\.pfx$",
    ".*\\.jks$",
    ".*\\.keystore$",
    "id_rsa.*",
    "id_ed25519.*",
    "id_ecdsa.*",
    "id_dsa.*",
  ];

  for (const pattern of sensitiveNamePatterns) {
    if (matchesPattern(lowerName, pattern) || matchesPattern(filePath, pattern)) {
      return true;
    }
  }

  for (const prefix of SENSITIVE_DIR_PREFIXES) {
    if (filePath.startsWith(prefix)) {
      return true;
    }
  }

  for (const homeFile of SENSITIVE_HOME_FILES) {
    if (filePath === homeFile) {
      return true;
    }
  }

  return false;
}

const input = await readInput<HookInput>();
const cwd = input.cwd ?? process.cwd();

const rawPath =
  input.file_path ??
  input.tool_input?.file_path ??
  input.tool_input?.path ??
  input.tool_input?.target_file ??
  input.tool_input?.old_file_path ??
  input.tool_input?.target_notebook ??
  "";

if (!rawPath) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

if (isSensitivePath(rawPath, cwd)) {
  const reason =
    "秘密情報を含む可能性があるファイルへのアクセスはブロックされています。";
  console.log(
    JSON.stringify({
      permission: "deny",
      user_message: reason,
      agent_message: reason,
    }),
  );
  process.exit(0);
}

console.log(JSON.stringify({ permission: "allow" }));
