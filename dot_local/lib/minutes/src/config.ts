import { homedir } from "node:os";
import { join } from "node:path";

export type Config = {
  minutesDir: string;
  dataDir: string;
  rawDir: string;
  dbPath: string;
  typosPath: string;
  ollamaHost: string;
  embedModel: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const home = homedir();
  const minutesDir = env.MINUTES_DIR || join(home, "minutes");
  const dataDir = join(env.XDG_DATA_HOME || join(home, ".local/share"), "minutes");
  return {
    minutesDir,
    dataDir,
    rawDir: join(dataDir, "raw"),
    dbPath: join(dataDir, "index.sqlite"),
    typosPath: join(minutesDir, "typos.tsv"),
    ollamaHost: env.OLLAMA_HOST || "http://127.0.0.1:11434",
    embedModel: env.MINUTES_EMBED_MODEL || "bge-m3",
  };
}
