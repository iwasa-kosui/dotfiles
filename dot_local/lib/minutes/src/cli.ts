import { parseArgs } from "node:util";
import { loadConfig } from "./config.ts";
import { ExternalError, UsageError } from "./errors.ts";
import { runIndex } from "./indexer.ts";
import { runIngest } from "./ingest.ts";
import { runRetypo } from "./retypo.ts";
import { formatResult, search } from "./search.ts";
import { runStatus } from "./status.ts";

const usage = `Usage: minutes <command> [options]

Convert Gemini meeting notes (docx) to Markdown, fix typos with a dictionary, and search them
with ollama embeddings plus full-text search.

Commands:
  ingest <path>... [--delete-source] [--no-index]
      Convert zip, directory, docx and Chat.txt inputs to Markdown, then run index.
  index
      Embed new or changed Markdown files.
  retypo
      Reapply the typo dictionary to every raw file, then run index.
  search <query> [--limit N] [--kind notes|transcript|chat] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json]
      Hybrid vector and full-text search (default limit 10).
  status
      Show counts and paths.

Markdown: $MINUTES_DIR or ~/minutes. Typos: <Markdown>/typos.tsv (tab separated "wrong<TAB>right").
Data: $XDG_DATA_HOME/minutes or ~/.local/share/minutes. ollama: $OLLAMA_HOST, model $MINUTES_EMBED_MODEL (default bge-m3).
Exit codes: 0 success, 1 no match, 2 invalid arguments, 3 external command (pandoc, ditto, ollama) failure.
`;

function parse<T extends Parameters<typeof parseArgs>[0]>(config: T) {
  try {
    return parseArgs({ ...config, strict: true, allowPositionals: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function noArguments(args: readonly string[], command: string): void {
  if (args.length > 0) throw new UsageError(`${command} は引数を取りません`);
}

async function dispatch(command: string, args: string[]): Promise<number> {
  const config = loadConfig();
  switch (command) {
    case "ingest": {
      const { values, positionals } = parse({
        args,
        options: { "delete-source": { type: "boolean" }, "no-index": { type: "boolean" } },
      });
      return runIngest(config, positionals, {
        deleteSource: Boolean(values["delete-source"]),
        noIndex: Boolean(values["no-index"]),
      });
    }
    case "index":
      noArguments(args, command);
      return runIndex(config);
    case "retypo":
      noArguments(args, command);
      return runRetypo(config);
    case "status":
      noArguments(args, command);
      return runStatus(config);
    case "search": {
      const { values, positionals } = parse({
        args,
        options: {
          limit: { type: "string" },
          kind: { type: "string" },
          since: { type: "string" },
          until: { type: "string" },
          json: { type: "boolean" },
        },
      });
      const query = positionals.join(" ").trim();
      if (query === "") throw new UsageError("検索語を指定してください");
      const limit = values.limit === undefined ? 10 : Number(values.limit);
      if (!Number.isInteger(limit) || limit < 1) throw new UsageError("--limit は1以上の整数で指定してください");
      const kind = values.kind as string | undefined;
      if (kind !== undefined && !["notes", "transcript", "chat"].includes(kind)) {
        throw new UsageError("--kind は notes, transcript, chat のいずれかです");
      }
      for (const name of ["since", "until"] as const) {
        const value = values[name] as string | undefined;
        if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new UsageError(`--${name} は YYYY-MM-DD で指定してください`);
        }
      }
      const results = await search(config, {
        query,
        limit,
        kind,
        since: values.since as string | undefined,
        until: values.until as string | undefined,
      });
      if (results.length === 0) {
        console.log("該当なし");
        return 1;
      }
      if (values.json) console.log(JSON.stringify(results, null, 2));
      else console.log(results.map(formatResult).join("\n\n"));
      return 0;
    }
    default:
      throw new UsageError(`不明なコマンド: ${command}`);
  }
}

export async function runCli(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || ["--help", "-h"].includes(argv[0])) {
    console.log(usage);
    return 0;
  }
  try {
    return await dispatch(argv[0], argv.slice(1));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error(usage);
      return 2;
    }
    if (error instanceof ExternalError) {
      console.error(error.message);
      return 3;
    }
    throw error;
  }
}
