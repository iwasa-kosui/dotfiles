import { parseArgs } from "node:util";
import { SendOutcomeUnknownError } from "./delivery.ts";

type TextInput = { kind: "text"; text: string } | { kind: "file"; path: string };
type Command =
  | { command: "help" }
  | { command: "list" }
  | { command: "read"; target: string }
  | { command: "search"; query: string }
  | { command: "send" | "reply"; target: string; input: TextInput };

export interface DMClient {
  list(): Promise<unknown>;
  read(target: string): Promise<unknown>;
  search(query: string): Promise<unknown>;
  send(handle: string, message: string): Promise<unknown>;
  reply(target: string, message: string): Promise<unknown>;
  close(): Promise<void>;
}

interface Dependencies {
  stdout(text: string): void;
  stderr(text: string): void;
  readStdin(): Promise<string>;
  loadClient(): Promise<DMClient>;
}

const HELP = `Usage:
  x-dm list
  x-dm read <name>
  x-dm search <query...>
  x-dm send <handle> <message...>
  x-dm reply <name> <message...>
  x-dm send <handle> --text <message>
  x-dm reply <name> --text-file <path|->

Options:
  --text <message>    本文をそのまま渡します。send / reply で使えます。
  --text-file <path>  ファイルから改行を含む本文を読みます。send / reply で使えます。
                     - を指定すると標準入力から読みます。
  -h, --help         ヘルプを表示します。ブラウザを起動しません。
  --                 以降を位置引数として扱います。

read / reply の name は会話名の部分一致です。複数一致はエラーになります。
send の handle は @ 付きでも指定できます。
Chrome と ~/.playwright/x-dm の専用プロファイルを使います。
成功結果は JSON を stdout に、エラーは stderr に出力します。
終了コード: 0 成功、1 実行失敗、2 引数・本文の不備、3 送信結果が未確定
outcome が unknown の場合は再送せず、会話履歴を確認してください。`;

class UsageError extends Error {}

function nonempty(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new UsageError(`${label}を指定してください`);
  return value;
}

export function parseArguments(args: string[]): Command {
  const { values, positionals, tokens } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h" },
      text: { type: "string" },
      "text-file": { type: "string" },
    },
    strict: true,
    allowPositionals: true,
    tokens: true,
  });
  const [command, ...rest] = positionals;
  if (args.length === 0 || (values.help && !command)) return { command: "help" };
  if (!["list", "read", "search", "send", "reply"].includes(command ?? "")) {
    throw new UsageError(`不明なコマンドです: ${command ?? "未指定"}`);
  }
  if (values.help) return { command: "help" };

  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new UsageError(`--${token.name} は1回だけ指定してください`);
    seen.add(token.name);
  }
  if (command !== "send" && command !== "reply" && (values.text !== undefined || values["text-file"] !== undefined)) {
    throw new UsageError("--text / --text-file は send / reply で使ってください");
  }

  switch (command) {
    case "list":
      if (rest.length) throw new UsageError("list に引数は不要です");
      return { command };
    case "read":
      if (rest.length !== 1) throw new UsageError("read には会話名を1つ指定してください");
      return { command, target: nonempty(rest[0]?.trim().replace(/^@/, ""), "会話名") };
    case "search":
      return { command, query: nonempty(rest.join(" "), "検索語") };
    case "send":
    case "reply": {
      const target = nonempty(rest[0]?.trim().replace(/^@/, ""), "宛先");
      if (command === "send" && !/^[A-Za-z0-9_]+$/.test(target)) {
        throw new UsageError("send の宛先は英数字と _ のユーザー名で指定してください");
      }
      const sources = Number(rest.length > 1) + Number(values.text !== undefined) + Number(values["text-file"] !== undefined);
      if (sources !== 1) throw new UsageError("本文は位置引数、--text、--text-file のいずれか1つで指定してください");
      const input: TextInput = values["text-file"] !== undefined
        ? { kind: "file", path: nonempty(values["text-file"], "本文ファイル") }
        : { kind: "text", text: nonempty(values.text ?? rest.slice(1).join(" "), "本文") };
      return { command, target, input };
    }
    default:
      throw new UsageError("コマンドを指定してください");
  }
}

async function readMessage(input: TextInput, readStdin: Dependencies["readStdin"]): Promise<string> {
  if (input.kind === "text") return input.text;
  let text: string;
  try {
    text = input.path === "-" ? await readStdin() : await Bun.file(input.path).text();
  } catch {
    throw new UsageError(`本文を読み込めません: ${input.path}`);
  }
  return nonempty(text, "本文");
}

export async function runCli(args: string[], dependencies: Partial<Dependencies> = {}): Promise<number> {
  const io: Dependencies = {
    stdout: console.log,
    stderr: console.error,
    readStdin: () => Bun.stdin.text(),
    loadClient: async () => (await import("./browser.ts")).createClient(),
    ...dependencies,
  };
  let command: Command;
  let message = "";
  try {
    command = parseArguments(args);
    if (command.command === "help") {
      io.stdout(HELP);
      return 0;
    }
    if (command.command === "send" || command.command === "reply") {
      message = await readMessage(command.input, io.readStdin);
    }
  } catch (error) {
    io.stderr(`x-dm: ${error instanceof Error ? error.message : String(error)}\n使い方: x-dm --help`);
    return 2;
  }

  try {
    const client = await io.loadClient();
    let result: unknown;
    try {
      switch (command.command) {
        case "list": result = await client.list(); break;
        case "read": result = await client.read(command.target); break;
        case "search": result = await client.search(command.query); break;
        case "send": result = await client.send(command.target, message); break;
        case "reply": result = await client.reply(command.target, message); break;
      }
    } finally {
      try {
        await client.close();
      } catch (error) {
        io.stderr(`x-dm: 警告: ブラウザの終了処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    io.stdout(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    if (error instanceof SendOutcomeUnknownError) {
      io.stdout(JSON.stringify(error.result, null, 2));
      io.stderr(`x-dm: ${error.message}`);
      return 3;
    }
    io.stderr(`x-dm: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(Bun.argv.slice(2));
}
