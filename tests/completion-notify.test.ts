import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "completion-notify-"));
const source = join(dir, "source");
const target = join(dir, "target");
const bin = join(dir, "bin");
const commands: Record<string, string> = {};
let invocation = 0;

function transcript(name: string, entry: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(entry) + "\n");
  return path;
}

const mainTranscript = transcript("main.jsonl", { type: "session_meta", payload: { source: "cli" } });
const childTranscript = transcript("child.jsonl", {
  type: "session_meta", payload: { source: { subagent: { thread_spawn: { depth: 1 } } } },
});
const internalTranscript = transcript("internal.jsonl", {
  type: "session_meta", payload: { source: { subagent: { other: "guardian" } } },
});
const compactTranscript = transcript("compact.jsonl", {
  type: "session_meta", payload: { source: { subagent: "compact" } },
});

beforeAll(() => {
  mkdirSync(source);
  mkdirSync(target);
  mkdirSync(bin);
  for (const app of ["codex", "claude"]) {
    const hooks = join(source, `dot_${app}/hooks`);
    mkdirSync(hooks, { recursive: true });
    for (const file of ["executable_completion-notify.ts", "completion-notify-lib.ts"]) {
      cpSync(join(root, `dot_${app}/hooks`, file), join(hooks, file));
    }
  }
  cpSync(join(root, "dot_codex/hooks.json"), join(source, "dot_codex/hooks.json"));
  cpSync(join(root, "dot_claude/modify_settings.json.tmpl"), join(source, "dot_claude/modify_settings.json.tmpl"));
  const config = join(dir, "config.toml");
  writeFileSync(config, '[data]\nprofile = "personal"\n');
  const result = Bun.spawnSync([
    "chezmoi", "--config", config, "--cache", join(dir, "cache"),
    "--persistent-state", join(dir, "state.db"), "--source", source,
    "--destination", target, "apply", "--exclude", "scripts", "--force",
  ], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  for (const [app, filename] of [["codex", "hooks.json"], ["claude", "settings.json"]]) {
    const config = JSON.parse(readFileSync(join(target, `.${app}`, filename!), "utf8"));
    commands[app!] = config.hooks.Stop[0].hooks[0].command.replace("~/", target + "/");
  }
  writeFileSync(join(bin, "terminal-notifier"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$NOTIFIER_LOG"\nexit "${NOTIFIER_EXIT_CODE:-0}"\n', { mode: 0o755 });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function runHook(app: string, input: unknown, exitCode = "0", raw = false) {
  const log = join(dir, `notifier-${invocation++}.log`);
  const proc = Bun.spawn(["/bin/sh", "-c", commands[app]!], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NOTIFIER_LOG: log, NOTIFIER_EXIT_CODE: exitCode },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  proc.stdin.write(raw ? String(input) : JSON.stringify(input));
  proc.stdin.end();
  const [code, stdout, stderr] = await Promise.all([
    proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  return existsSync(log) ? readFileSync(log, "utf8").trimEnd().split("\n") : [];
}

test("notification implementations stay in sync", () => {
  expect(readFileSync(join(root, "dot_codex/hooks/completion-notify-lib.ts"), "utf8"))
    .toBe(readFileSync(join(root, "dot_claude/hooks/completion-notify-lib.ts"), "utf8"));
});

for (const [app, title] of [["codex", "Codex"], ["claude", "Claude Code"]] as const) {
  describe(`${app} deployed Stop hook`, () => {
    const main = { hook_event_name: "Stop", transcript_path: mainTranscript, stop_hook_active: false };
    const notification = ["-title", title, "-message", "タスクが完了しました", "-sound", "Glass", "-sender", "com.apple.Terminal"];

    test("main session still notifies, including named agents and turns resumed by a Stop hook", async () => {
      expect(await runHook(app, main)).toEqual(notification);
      expect(await runHook(app, { ...main, agent_type: "reviewer", agent_id: "", background_tasks: [] })).toEqual(notification);
      expect(await runHook(app, { ...main, stop_hook_active: true })).toEqual(notification);
      expect(await runHook(app, { hook_event_name: "Stop", transcript_path: null })).toEqual(notification);
    });

    test("subagents, unrelated events, and parents waiting on background work are silent", async () => {
      for (const input of [
        { ...main, agent_id: "child-1" },
        { ...main, agent_transcript_path: childTranscript },
        { ...main, hook_event_name: "SubagentStop" },
        { ...main, hook_event_name: "Notification" },
        { ...main, background_tasks: [{ id: "child-1", type: "subagent", status: "running" }] },
        {}, null, [], { ...main, transcript_path: 42 },
      ]) expect(await runHook(app, input)).toEqual([]);
      expect(await runHook(app, "not JSON", "0", true)).toEqual([]);
    });

    test("notifier failures do not block completion or leak output into hooks", async () => {
      expect(await runHook(app, main, "1")).toEqual(notification);
    });
  });
}

test("Codex excludes spawned and internal sessions even when Stop has no agent_id", async () => {
  for (const path of [childTranscript, internalTranscript, compactTranscript]) {
    expect(await runHook("codex", { hook_event_name: "Stop", transcript_path: path })).toEqual([]);
  }
});

test("Codex skips unreadable or unrecognized metadata", async () => {
  const broken = join(dir, "broken.jsonl");
  writeFileSync(broken, "{unfinished");
  for (const path of [broken, join(dir, "missing.jsonl"), transcript("unknown.jsonl", {})]) {
    expect(await runHook("codex", { hook_event_name: "Stop", transcript_path: path })).toEqual([]);
  }
});

test("Claude excludes legacy child transcript paths without filtering named main agents", async () => {
  for (const path of ["/tmp/session/subagents/child.jsonl", "/tmp/session/agent-child.jsonl"]) {
    expect(await runHook("claude", { hook_event_name: "Stop", transcript_path: path })).toEqual([]);
  }
});
