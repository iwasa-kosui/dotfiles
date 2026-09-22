// dot_codex/hooks/ と dot_claude/hooks/ で同一内容を保つこと。
import { basename } from "node:path";

type Runtime = "codex" | "claude";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function shouldNotify(runtime: Runtime, input: unknown): Promise<boolean> {
  if (!isRecord(input) || input.hook_event_name !== "Stop") return false;
  // agent_type はメインセッションの --agent 指定でも付くため判定に使わない。
  if (input.agent_id != null && input.agent_id !== "") return false;
  if (input.agent_transcript_path != null && input.agent_transcript_path !== "") return false;

  // 親がバックグラウンドの子タスクを待っているだけの Stop も通知しない。
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) return false;

  const path = input.transcript_path;
  if (path == null || path === "") return true;
  if (typeof path !== "string") return false;
  // 古い Claude Code で agent_id が省略される場合も子の transcript を除外する。
  if (runtime === "claude") {
    return !path.split("/").includes("subagents") && !/^agent-.*\.jsonl$/.test(basename(path));
  }

  // Codex の子セッションで Stop に agent_id が付かない場合は session_meta を使う。
  // transcript は非公開形式なので先頭レコードだけ読み、判別不能なら誤通知を避ける。
  try {
    const head = await Bun.file(path).slice(0, 64 * 1024).text();
    const entry: unknown = JSON.parse(head.split("\n")[0] ?? "");
    if (!isRecord(entry) || entry.type !== "session_meta" || !isRecord(entry.payload)) return false;
    const source = entry.payload.source;
    if (isRecord(source) && "subagent" in source) return false;
    return typeof source === "string" && source !== "" && source !== "subagent";
  } catch {
    return false;
  }
}

export async function notifyCompletion(runtime: Runtime): Promise<void> {
  try {
    const input: unknown = JSON.parse(await Bun.stdin.text());
    if (!(await shouldNotify(runtime, input))) return;

    const notifier = Bun.spawn([
      "terminal-notifier",
      "-title", runtime === "codex" ? "Codex" : "Claude Code",
      "-message", "タスクが完了しました",
      "-sound", "Glass",
      "-sender", "com.apple.Terminal",
    ], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    await notifier.exited;
  } catch {
    // 不正な入力や通知コマンドの失敗でセッションの終了を妨げない。
  }
}
