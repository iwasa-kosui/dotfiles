#!/usr/bin/env bun
// Claude Code statusline script (Bun TypeScript)
// Line 1: Model | Context% | +added/-removed | git branch
// Line 2: 5h rate limit progress bar
// Line 3: 7d rate limit progress bar

import { readInput, runSafe } from "./hooks/lib.ts";

// ---------- Types ----------
interface StdinInput {
  model?: { id?: string; display_name?: string };
  context_window?: { used_percentage?: number };
  cost?: { total_lines_added?: number; total_lines_removed?: number };
  cwd?: string;
  version?: string;
  workspace?: { current_dir?: string; project_dir?: string };
}

interface CacheData {
  five_hour_util: string;
  five_hour_reset: string;
  seven_day_util: string;
  seven_day_reset: string;
}

// ---------- ANSI Colors ----------
const GREEN = "\x1b[38;2;151;201;195m";
const YELLOW = "\x1b[38;2;229;192;123m";
const RED = "\x1b[38;2;224;108;117m";
const GRAY = "\x1b[38;2;74;88;92m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const CACHE_FILE = "/tmp/claude-usage-cache.json";
const CACHE_TTL = 360;

function colorForPct(pct: number | null): string {
  if (pct === null) return GRAY;
  if (pct >= 80) return RED;
  if (pct >= 50) return YELLOW;
  return GREEN;
}

function progressBar(pct: number): string {
  const filled = Math.min(10, Math.max(0, Math.round(pct / 10)));
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

async function getGitBranch(cwd: string): Promise<string | null> {
  const branch = await runSafe([
    "git",
    "-C",
    cwd,
    "--no-optional-locks",
    "symbolic-ref",
    "--short",
    "HEAD",
  ]);
  if (branch) return branch;
  return runSafe([
    "git",
    "-C",
    cwd,
    "--no-optional-locks",
    "rev-parse",
    "--short",
    "HEAD",
  ]);
}

async function getOAuthToken(): Promise<string | null> {
  const raw = await runSafe([
    "security",
    "find-generic-password",
    "-s",
    "Claude Code-credentials",
    "-w",
  ]);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return raw;
  }
}

async function fetchUsage(
  ccVersion: string,
): Promise<CacheData | null> {
  const token = await getOAuthToken();
  if (!token) return null;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": `claude-code/${ccVersion}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "h" }],
      }),
      signal: AbortSignal.timeout(8000),
    });

    const h5Util = resp.headers.get(
      "anthropic-ratelimit-unified-5h-utilization",
    );
    const h5Reset = resp.headers.get(
      "anthropic-ratelimit-unified-5h-reset",
    );
    const h7Util = resp.headers.get(
      "anthropic-ratelimit-unified-7d-utilization",
    );
    const h7Reset = resp.headers.get(
      "anthropic-ratelimit-unified-7d-reset",
    );

    if (!h5Util) return null;

    const data: CacheData = {
      five_hour_util: h5Util,
      five_hour_reset: h5Reset ?? "",
      seven_day_util: h7Util ?? "",
      seven_day_reset: h7Reset ?? "",
    };

    await Bun.write(CACHE_FILE, JSON.stringify(data));
    return data;
  } catch {
    return null;
  }
}

async function loadCachedUsage(): Promise<CacheData | null> {
  const file = Bun.file(CACHE_FILE);
  if (!(await file.exists())) return null;

  try {
    const stat = await file.stat();
    if (!stat) return null;

    const age = (Date.now() - stat.mtimeMs) / 1000;
    return { data: JSON.parse(await file.text()), fresh: age < CACHE_TTL } as never;
  } catch {
    return null;
  }
}

async function getUsage(
  ccVersion: string,
): Promise<CacheData | null> {
  const file = Bun.file(CACHE_FILE);
  let cached: CacheData | null = null;
  let isFresh = false;

  if (await file.exists()) {
    try {
      const stat = await file.stat();
      if (stat) {
        const age = (Date.now() - stat.mtimeMs) / 1000;
        isFresh = age < CACHE_TTL;
        cached = JSON.parse(await file.text()) as CacheData;
      }
    } catch {
      // ignore
    }
  }

  if (isFresh && cached) return cached;

  const fresh = await fetchUsage(ccVersion);
  return fresh ?? cached;
}

function utilToPct(val: string): number | null {
  if (!val || val === "0") return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

function formatEpochTime(epoch: string, format: "5h" | "7d"): string {
  if (!epoch || epoch === "0") return "";
  const epochNum = parseInt(epoch, 10);
  if (isNaN(epochNum)) return "";

  const date = new Date(epochNum * 1000);
  const formatter =
    format === "5h"
      ? new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          hour12: true,
          timeZone: "Asia/Tokyo",
        })
      : new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          hour12: true,
          timeZone: "Asia/Tokyo",
        });

  const parts = formatter.formatToParts(date);
  const getText = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  if (format === "5h") {
    const hour = getText("hour");
    const dp = getText("dayPeriod").toLowerCase();
    return `Resets ${hour}${dp} (Asia/Tokyo)`;
  }

  const month = getText("month");
  const day = getText("day");
  const hour = getText("hour");
  const dp = getText("dayPeriod").toLowerCase();
  return `Resets ${month} ${day} at ${hour}${dp} (Asia/Tokyo)`;
}

// ---------- Main ----------
const input = await readInput<StdinInput>();

const modelName = input.model?.display_name ?? "Unknown";
const usedPct = input.context_window?.used_percentage ?? 0;
const cwd = input.workspace?.current_dir ?? input.cwd ?? "";
const linesAdded = input.cost?.total_lines_added ?? 0;
const linesRemoved = input.cost?.total_lines_removed ?? 0;
const ccVersion = input.version ?? "0.0.0";

// Git branch
const gitBranch = cwd ? await getGitBranch(cwd) : null;

// Git stats
const gitStats =
  linesAdded > 0 || linesRemoved > 0
    ? `+${linesAdded}/-${linesRemoved}`
    : null;

// Rate limit usage
const usage = await getUsage(ccVersion);
const fiveHourPct = usage ? utilToPct(usage.five_hour_util) : null;
const sevenDayPct = usage ? utilToPct(usage.seven_day_util) : null;

// Context percentage
const ctxPctInt = Math.round(usedPct);

// ---------- Line 1 ----------
const SEP = `${GRAY} │ ${RESET}`;
const ctxColor = colorForPct(ctxPctInt);

let line1 = `🤖 ${modelName}${SEP}${ctxColor}📊 ${ctxPctInt}%${RESET}`;

if (gitStats) {
  line1 += `${SEP}✏️  ${GREEN}${gitStats}${RESET}`;
}
if (gitBranch) {
  line1 += `${SEP}🔀 ${gitBranch}`;
}

// ---------- Line 2 (5h) ----------
let line2: string;
if (fiveHourPct !== null) {
  const c5 = colorForPct(fiveHourPct);
  const bar5 = progressBar(fiveHourPct);
  line2 = `${c5}⏱ 5h  ${bar5}  ${fiveHourPct}%${RESET}`;
  const resetDisplay = usage
    ? formatEpochTime(usage.five_hour_reset, "5h")
    : "";
  if (resetDisplay) line2 += `  ${DIM}${resetDisplay}${RESET}`;
} else {
  line2 = `${GRAY}⏱ 5h  ▱▱▱▱▱▱▱▱▱▱  --%${RESET}`;
}

// ---------- Line 3 (7d) ----------
let line3: string;
if (sevenDayPct !== null) {
  const c7 = colorForPct(sevenDayPct);
  const bar7 = progressBar(sevenDayPct);
  line3 = `${c7}📅 7d  ${bar7}  ${sevenDayPct}%${RESET}`;
  const resetDisplay = usage
    ? formatEpochTime(usage.seven_day_reset, "7d")
    : "";
  if (resetDisplay) line3 += `  ${DIM}${resetDisplay}${RESET}`;
} else {
  line3 = `${GRAY}📅 7d  ▱▱▱▱▱▱▱▱▱▱  --%${RESET}`;
}

// ---------- Output ----------
process.stdout.write(`${line1}\n${line2}\n${line3}`);
