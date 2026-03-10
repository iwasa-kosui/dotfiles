#!/usr/bin/env bun
// Claude Code statusline script (Bun TypeScript)
// Subdued monochrome Powerline with Tokyo Night dark backgrounds
// Line 1: Model  Context bar %  +added/-removed  git branch  worktree
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

// ---------- Tokyo Night Palette (subdued) ----------
const TN = {
  // Backgrounds — dark, low-contrast tiers
  bgBase: [26, 27, 38],
  bgSurface: [36, 40, 59],
  bgOverlay: [41, 46, 66],
  // Foregrounds — muted tones for normal state
  fg: [192, 202, 245],
  fgDim: [139, 147, 185],
  fgMuted: [110, 118, 158],
  // Accent — only for warnings/alerts
  green: [130, 180, 100],
  yellow: [200, 160, 90],
  red: [220, 110, 130],
  comment: [86, 95, 137],
} as const;

const fgC = (c: readonly number[]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bgC = (c: readonly number[]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const SEP = "\ue0b0"; // Powerline separator

// ---------- Powerline Segment Builder ----------
type Segment = { text: string; fgColor: readonly number[]; bgColor: readonly number[]; dim?: boolean };

function renderSegments(segments: Segment[]): string {
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const style = s.dim ? DIM : "";
    out += `${bgC(s.bgColor)}${fgC(s.fgColor)}${style}${s.text}${RESET}`;
    const nextBg = i + 1 < segments.length ? segments[i + 1].bgColor : null;
    if (nextBg) {
      out += `${fgC(s.bgColor)}${bgC(nextBg)}${SEP}${RESET}`;
    } else {
      out += `${fgC(s.bgColor)}${SEP}${RESET}`;
    }
  }
  return out;
}

// ---------- Rate Limit Segment Builder ----------
function renderRateLine(
  label: string,
  pct: number | null,
  resetDisplay: string,
): string {
  const barColor = pct !== null ? colorForPct(pct) : TN.comment;
  const bar = pct !== null ? progressBar(pct) : "\u25b1".repeat(10);
  const pctText = pct !== null ? `${pct}%` : "--%";

  const segments: Segment[] = [
    { text: ` ${label} `, fgColor: TN.fgMuted, bgColor: TN.bgSurface, dim: true },
    { text: ` ${bar}  ${pctText} `, fgColor: barColor, bgColor: TN.bgOverlay },
  ];

  let out = renderSegments(segments);
  if (resetDisplay) {
    out += ` ${fgC(TN.comment)}${resetDisplay}${RESET}`;
  }
  return out;
}

const CACHE_FILE = "/tmp/claude-usage-cache.json";
const CACHE_TTL = 360;

function colorForPct(pct: number | null): readonly number[] {
  if (pct === null) return TN.comment;
  if (pct >= 80) return TN.red;
  if (pct >= 50) return TN.yellow;
  return TN.fgMuted;
}

function colorForCtxPct(pct: number): readonly number[] {
  if (pct >= 40) return TN.red;
  if (pct >= 25) return TN.yellow;
  return TN.fgMuted;
}

function progressBar(pct: number): string {
  const filled = Math.min(10, Math.max(0, Math.round(pct / 10)));
  return "\u25b0".repeat(filled) + "\u25b1".repeat(10 - filled);
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

async function getWorktreeName(cwd: string): Promise<string | null> {
  const [gitDir, commonDir] = await Promise.all([
    runSafe(["git", "-C", cwd, "--no-optional-locks", "rev-parse", "--git-dir"]),
    runSafe(["git", "-C", cwd, "--no-optional-locks", "rev-parse", "--git-common-dir"]),
  ]);
  if (!gitDir || !commonDir || gitDir === commonDir) return null;
  const toplevel = await runSafe([
    "git", "-C", cwd, "--no-optional-locks", "rev-parse", "--show-toplevel",
  ]);
  if (!toplevel) return null;
  return toplevel.split("/").pop() ?? null;
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
    return `Resets ${hour}${dp} JST`;
  }

  const month = getText("month");
  const day = getText("day");
  const hour = getText("hour");
  const dp = getText("dayPeriod").toLowerCase();
  return `Resets ${month} ${day} ${hour}${dp} JST`;
}

// ---------- Main ----------
const input = await readInput<StdinInput>();

const modelName = input.model?.display_name ?? "Unknown";
const usedPct = input.context_window?.used_percentage ?? 0;
const cwd = input.workspace?.current_dir ?? input.cwd ?? "";
const linesAdded = input.cost?.total_lines_added ?? 0;
const linesRemoved = input.cost?.total_lines_removed ?? 0;
const ccVersion = input.version ?? "0.0.0";

// Git branch & worktree
const [gitBranch, worktreeName] = cwd
  ? await Promise.all([getGitBranch(cwd), getWorktreeName(cwd)])
  : [null, null];

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
const ctxColor = colorForCtxPct(ctxPctInt);
const ctxBar = progressBar(ctxPctInt);

// ---------- Line 1: Powerline segments ----------
const line1Segments: Segment[] = [
  { text: ` \uf0e7 ${modelName} `, fgColor: TN.fgDim, bgColor: TN.bgSurface },
  { text: ` \uf080 ${ctxBar} ${ctxPctInt}% `, fgColor: ctxColor, bgColor: TN.bgOverlay },
];

if (gitStats) {
  line1Segments.push({
    text: ` \uf040 ${gitStats} `,
    fgColor: TN.fgMuted,
    bgColor: TN.bgSurface,
  });
}

if (gitBranch) {
  line1Segments.push({
    text: ` \ue0a0 ${gitBranch} `,
    fgColor: TN.fgDim,
    bgColor: TN.bgOverlay,
  });
}

if (worktreeName) {
  line1Segments.push({
    text: ` \uf1bb ${worktreeName} `,
    fgColor: TN.comment,
    bgColor: TN.bgSurface,
    dim: true,
  });
}

const line1 = renderSegments(line1Segments);

// ---------- Line 2 (5h) ----------
const reset5h = usage ? formatEpochTime(usage.five_hour_reset, "5h") : "";
const line2 = renderRateLine("\uf017 5h", fiveHourPct, reset5h);

// ---------- Line 3 (7d) ----------
const reset7d = usage ? formatEpochTime(usage.seven_day_reset, "7d") : "";
const line3 = renderRateLine("\uf073 7d", sevenDayPct, reset7d);

// ---------- Output ----------
process.stdout.write(`${line1}\n${line2}\n${line3}`);
