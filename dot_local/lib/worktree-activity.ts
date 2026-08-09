import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ActivitySource = "claude" | "codex" | "nvim";

export type Activity = {
  path: string;
  source: ActivitySource;
  lastUsedAt: number;
};

export type ActivityOptions = {
  stateDir?: string;
  now?: number;
  resolveWorktreeRoot?: (cwd: string) => Promise<string>;
};

const sources = new Set<ActivitySource>(["claude", "codex", "nvim"]);
const execFileAsync = promisify(execFile);

async function canonicalPath(path: string): Promise<string> {
  const resolved = resolve(path);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

export async function resolveWorktreeRoot(cwd: string): Promise<string> {
  const candidate = await canonicalPath(cwd);
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      candidate,
      "rev-parse",
      "--show-toplevel",
    ]);
    const toplevel = stdout.trim();
    return toplevel ? await canonicalPath(toplevel) : candidate;
  } catch {
    return candidate;
  }
}

export function activityStateDir(): string {
  return join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "worktree-activity",
  );
}

function activityPath(
  stateDir: string,
  activity: Pick<Activity, "path" | "source">,
): string {
  const digest = createHash("sha256")
    .update(`${activity.path}\0${activity.source}`)
    .digest("hex");
  return join(stateDir, `${digest}.json`);
}

function isActivity(value: unknown): value is Activity {
  if (!value || typeof value !== "object") {
    return false;
  }

  const activity = value as Record<string, unknown>;
  return (
    typeof activity.path === "string" &&
    sources.has(activity.source as ActivitySource) &&
    typeof activity.lastUsedAt === "number" &&
    Number.isFinite(activity.lastUsedAt)
  );
}

export async function recordActivity(
  cwd: string,
  source: ActivitySource,
  options: ActivityOptions = {},
): Promise<Activity> {
  const stateDir = options.stateDir ?? activityStateDir();
  const rootResolver = options.resolveWorktreeRoot ?? resolveWorktreeRoot;
  const activity: Activity = {
    path: await rootResolver(cwd),
    source,
    lastUsedAt: options.now ?? Date.now(),
  };
  const destination = activityPath(stateDir, activity);
  const temporary = `${destination}.${randomUUID()}.tmp`;

  await mkdir(stateDir, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(activity)}\n`);
  await rename(temporary, destination);

  return activity;
}

export async function readActivities(
  options: ActivityOptions = {},
): Promise<Activity[]> {
  const stateDir = options.stateDir ?? activityStateDir();
  let entries: string[];
  try {
    entries = await readdir(stateDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const activities = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        try {
          const parsed: unknown = JSON.parse(
            await readFile(join(stateDir, entry), "utf8"),
          );
          return isActivity(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }),
  );

  return activities
    .filter((activity): activity is Activity => activity !== undefined)
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.source.localeCompare(right.source),
    );
}
