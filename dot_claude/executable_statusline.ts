#!/usr/bin/env bun
// Claude Code statusline
// claude-powerline を子プロセスとして実行し、出力をラップする薄いスクリプト。
// claude-powerline には無い PR番号・effort level・コンテキスト超過警告・費用の
// 4つを capsule として追記する。PR番号は OSC 8 でリンクし、PR番号と effort
// level は stdin の JSON に該当フィールドがあるときだけ出す。コンテキスト警告は、
// context segment の色が残り割合の固定閾値でしか変わらず、1Mコンテキストで
// 0.2Mを超えたことを絶対トークン数で警告できないため自前で持つ。
// さらに session segment のトークン数を、後処理で万・億表記に置き換える。
//
// 費用は claude-powerline の today セグメントを使わず自前で出す。claude-powerline
// の単価表に claude-opus-5-5 が無く、旧 Opus 4 単価にフォールバックして今日の
// 費用が実際の約2倍で表示されるため。claude-powerline.json では today セグメント
// を無効化している。

// 1Mコンテキストのセッションでも0.2Mを超えたら警告する。
// 割合ではなく絶対トークン数で判定するのは、1Mでは0.2Mが20%にすぎず
// claude-powerline の閾値（残り40%以下で警告）に到達しないため。
const CONTEXT_WARN_TOKENS = 200_000;

interface StdinInput {
  context_window?: {
    current_usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  effort?: { level?: string };
  pr?: { number?: number; url?: string };
  cost?: { total_cost_usd?: number };
}

// Tokyo Night: claude-powerline の tokyo-night テーマに合わせた配色
const BG = [36, 40, 59] as const;
const FG = [86, 95, 137] as const;
// tokyo-night テーマの contextCritical と同色
const WARN_BG = [247, 118, 142] as const;
const WARN_FG = [26, 27, 38] as const;
// tokyo-night テーマの green / teal。費用 capsule だけ DIM をやめてはっきり見せる。
// PR・effort（DIM のグレー系）、警告（赤系）と被らない色を選んでいる
const COST_FG = [158, 206, 106] as const;
const COST_FG_TODAY = [115, 218, 202] as const;

const fgC = (c: readonly number[]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bgC = (c: readonly number[]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
// 太字だけを解除し、色は変えずに残す（capsule の背景色を RESET で壊さないため）
const NORMAL = "\x1b[22m";
// Nerd Font の Private Use Area はエディタやツールを通すと欠落しやすいためエスケープで書く
const CAP_LEFT = "\ue0b6"; // nf-pl-left_half_circle_thick
const CAP_RIGHT = "\ue0b4"; // nf-pl-right_half_circle_thick
const WARN_ICON = "\uf071"; // nf-fa-warning
const EFFORT_ICON = "\uf0e4"; // nf-fa-dashboard
const PR_ICON = "\uf407"; // nf-oct-git_pull_request
const COST_ICON = "\uf155"; // nf-fa-dollar

const capsule = (
  bg: readonly number[],
  fg: readonly number[],
  text: string,
  attr: string,
) =>
  `${fgC(bg)}${CAP_LEFT}${RESET}` +
  `${bgC(bg)}${fgC(fg)}${attr} ${text} ${RESET}` +
  `${fgC(bg)}${CAP_RIGHT}${RESET}`;

// 3桁区切りの K / M は4桁区切りの日本語だと量が掴みにくいので、万・億に置き換える
const jaCount = (n: number) => {
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (n >= 100_000_000) return `${trim((n / 100_000_000).toFixed(1))}億`;
  if (n >= 10_000) {
    const man = n / 10_000;
    return man >= 100 ? `${Math.round(man)}万` : `${trim(man.toFixed(1))}万`;
  }
  return `${Math.round(n)}`;
};

const jaTokens = (n: number) => `${jaCount(n)}トークン`;

// OSC 8。対応端末では text がクリック可能になる
const link = (url: string, text: string) =>
  `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;

// 今日の費用（ccusage の daily 集計）のキャッシュ。
// ccusage は数秒かかりうるため、描画をブロックせずバックグラウンドで更新する。
const CACHE_DIR = `${process.env.HOME}/.claude/cache`;
const TODAY_COST_CACHE_PATH = `${CACHE_DIR}/statusline-today-cost.json`;
const TODAY_COST_LOCK_PATH = `${CACHE_DIR}/statusline-today-cost.lock`;
// このキャッシュより古ければバックグラウンドで再取得する
const TODAY_COST_STALE_MS = 60_000;
// この時間より古いロックは前回の更新が失敗したとみなして掃除する
const TODAY_COST_LOCK_STALE_MS = 30_000;
// PATH に依存しないよう ccusage の絶対パスを解決する
const CCUSAGE_PATH =
  Bun.which("ccusage") ?? `${process.env.HOME}/.bun/bin/ccusage`;

interface TodayCostCache {
  date: string;
  totalCost: number;
  updatedAt: number;
}

// JST（Asia/Tokyo）の日付。ccusage 側の集計と揃える
const jstDateString = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );

const readTodayCostCache = async (): Promise<TodayCostCache | null> => {
  try {
    return (await Bun.file(TODAY_COST_CACHE_PATH).json()) as TodayCostCache;
  } catch {
    return null;
  }
};

// 多重起動防止のロック。stale なロックは前回の失敗とみなして掃除して取り直す
const acquireTodayCostLock = async (): Promise<boolean> => {
  const fs = await import("node:fs");
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.closeSync(fs.openSync(TODAY_COST_LOCK_PATH, "wx"));
    return true;
  } catch {
    try {
      const stale =
        Date.now() - fs.statSync(TODAY_COST_LOCK_PATH).mtimeMs >
        TODAY_COST_LOCK_STALE_MS;
      if (!stale) return false;
      fs.unlinkSync(TODAY_COST_LOCK_PATH);
      fs.closeSync(fs.openSync(TODAY_COST_LOCK_PATH, "wx"));
      return true;
    } catch {
      return false;
    }
  }
};

// ccusage daily は数秒かかりうるので、statusline の描画をブロックしないよう
// detach したプロセスで実行してキャッシュファイルだけ更新する
const refreshTodayCostInBackground = async (date: string) => {
  if (!(await acquireTodayCostLock())) return;
  const compact = date.replaceAll("-", "");
  const script = `
    import { unlinkSync } from "node:fs";
    const cachePath = ${JSON.stringify(TODAY_COST_CACHE_PATH)};
    const lockPath = ${JSON.stringify(TODAY_COST_LOCK_PATH)};
    try {
      const proc = Bun.spawn(
        [${JSON.stringify(CCUSAGE_PATH)}, "daily", "--since", ${JSON.stringify(compact)}, "--until", ${JSON.stringify(compact)}, "--timezone", "Asia/Tokyo", "--json"],
        { stdout: "pipe", stderr: "ignore" },
      );
      const text = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        const totalCost = JSON.parse(text)?.totals?.totalCost;
        if (typeof totalCost === "number") {
          await Bun.write(
            cachePath,
            JSON.stringify({ date: ${JSON.stringify(date)}, totalCost, updatedAt: Date.now() }),
          );
        }
      }
    } catch {
      // 取得失敗時はキャッシュを更新せず、次回の呼び出しで再試行させる
    } finally {
      try { unlinkSync(lockPath); } catch {}
    }
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();
};

const raw = await Bun.stdin.text();

let input: StdinInput = {};
try {
  input = JSON.parse(raw) as StdinInput;
} catch {
  // 追記分を諦めて claude-powerline の出力だけ返す
}

// claude-powerline の子プロセス待ちと並行してキャッシュを読む
const todayDate = jstDateString();
const todayCostCachePromise = readTodayCostCache();

const proc = Bun.spawn(["claude-powerline"], {
  stdin: new Response(raw),
  stdout: "pipe",
  stderr: "inherit",
});
const out = await new Response(proc.stdout).text();
await proc.exited;

// claude-powerline の session セグメント（`§ 3.4M tokens`）だけを日本語表記にする。
// `§ ` を含めてマッチさせることで today など他セグメントの tokens 表記には触らない
const localizeSessionTokens = (s: string) =>
  s.replace(
    /§ (\d+(?:\.\d+)?)([KM])? tokens/,
    (_, num: string, unit?: string) => {
      const scale = unit === "M" ? 1_000_000 : unit === "K" ? 1_000 : 1;
      return `§ ${jaTokens(Number(num) * scale)}`;
    },
  );

process.stdout.write(localizeSessionTokens(out));

// current_usage は Claude Code 2.0.70+ でのみ渡ってくる。無い場合は警告を出さない。
const usage = input.context_window?.current_usage;
const contextTokens = usage
  ? (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  : null;

const effortLevel = input.effort?.level ?? null;
const prNumber = input.pr?.number ?? null;
const prUrl = input.pr?.url ?? null;
const sessionCost = input.cost?.total_cost_usd ?? null;

const cachedTodayCost = await todayCostCachePromise;
const todayCostStale =
  !cachedTodayCost ||
  cachedTodayCost.date !== todayDate ||
  Date.now() - cachedTodayCost.updatedAt > TODAY_COST_STALE_MS;
if (todayCostStale) void refreshTodayCostInBackground(todayDate);
const todayCost =
  cachedTodayCost && cachedTodayCost.date === todayDate
    ? cachedTodayCost.totalCost
    : null;

const extras: string[] = [];

if (prNumber !== null && prUrl) {
  extras.push(link(prUrl, capsule(BG, FG, `${PR_ICON} #${prNumber}`, DIM)));
}

if (effortLevel) {
  extras.push(capsule(BG, FG, `${EFFORT_ICON} ${effortLevel}`, DIM));
}

if (sessionCost !== null || todayCost !== null) {
  const parts: string[] = [];
  // セッション費用は太字の green で強調し、today 費用は teal で区別する。
  // どちらも DIM は使わず、capsule の背景に対して十分なコントラストを保つ
  if (sessionCost !== null)
    parts.push(`${BOLD}$${sessionCost.toFixed(2)}${NORMAL}`);
  if (todayCost !== null)
    parts.push(
      `${fgC(COST_FG_TODAY)}(today $${todayCost.toFixed(2)})${fgC(COST_FG)}`,
    );
  extras.push(capsule(BG, COST_FG, `${COST_ICON} ${parts.join(" ")}`, ""));
}

if (contextTokens !== null && contextTokens > CONTEXT_WARN_TOKENS) {
  extras.push(
    capsule(
      WARN_BG,
      WARN_FG,
      `${WARN_ICON} CONTEXT ${jaCount(contextTokens)}`,
      BOLD,
    ),
  );
}

if (extras.length > 0) {
  if (!out.endsWith("\n")) process.stdout.write("\n");
  process.stdout.write(extras.join(" "));
}
