import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Allowlist = readonly string[];

export function parseAllowlist(text: string): Allowlist {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function isHostAllowed(host: string, allowlist: Allowlist): boolean {
  const target = host.toLowerCase();
  return allowlist.some((entry) => {
    if (entry.startsWith(".")) {
      const domain = entry.slice(1);
      return target === domain || target.endsWith(entry);
    }
    return target === entry;
  });
}

export function allowlistPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "web-fetch", "allowlist");
}

export async function loadAllowlist(path?: string): Promise<Allowlist> {
  try {
    const text = await readFile(path ?? allowlistPath(), "utf8");
    return parseAllowlist(text);
  } catch {
    return [];
  }
}
