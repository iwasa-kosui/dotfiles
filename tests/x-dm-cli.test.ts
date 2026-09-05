import { afterEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArguments, runCli } from "../dot_local/lib/x-dm/src/cli.ts";
import { findConversationIndex, findRecipientIndex, parseConversation } from "../dot_local/lib/x-dm/src/conversation.ts";
import { compose, openConversation, send } from "../dot_local/lib/x-dm/src/browser.ts";
import { SendOutcomeUnknownError, type DeliverySnapshot } from "../dot_local/lib/x-dm/src/delivery.ts";
type BrowserPage = Parameters<typeof openConversation>[0];

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DM conversation selection", () => {
  test("keeps case-insensitive name matching for an unambiguous conversation", () => {
    expect(findConversationIndex(["other", "KaWaUsO"], "kawauso")).toBe(1);
  });

  test("ambiguous names fail before a conversation can be selected", () => {
    expect(() => findConversationIndex(["かわうそA", "かわうそB"], "かわうそ")).toThrow("複数");
  });

  test("a missing conversation cannot accidentally select the first item", () => {
    expect(() => findConversationIndex(["other"], "かわうそ")).toThrow("見つかりません");
  });

  test("new DM selection uses the exact handle rather than the first search result", () => {
    expect(findRecipientIndex(["@name_extra", "@Name"], "name")).toBe(1);
  });

  test("new DM selection rejects ambiguous or absent handles", () => {
    expect(() => findRecipientIndex(["@name", "@name"], "name")).toThrow("複数");
    expect(() => findRecipientIndex(["@another"], "name")).toThrow("見つかりません");
  });

  test("retains the existing conversation JSON fields", () => {
    expect(parseConversation("/i/chat/123-456", "かわうそ3日こんにちは")).toEqual({
      id: "123-456", name: "かわうそ", lastMessage: "こんにちは", timestamp: "3日",
    });
    expect(parseConversation("/i/chat/123-456", "かわうそ")).toEqual({
      id: "123-456", name: "かわうそ", lastMessage: "", timestamp: "",
    });
  });
});

function identityPage(cards: { conversationText?: string; profileHrefs?: string[]; fullText: string }[], typeahead?: "nested" | "empty") {
  const clicks: number[] = [];
  let observations = 0;
  const locator = (texts: string[], click?: () => void): any => ({
    count: async () => texts.length,
    allTextContents: async () => texts,
    textContent: async () => texts[0] ?? null,
    innerText: async () => texts[0] ?? "",
    nth: (index: number) => ({ getAttribute: async () => texts[index] ?? null }),
    first() { return this; },
    waitFor: async () => {},
    click: async () => { click?.(); },
    fill: async () => {},
    press: async () => {},
  });
  const items = {
    count: async () => cards.length,
    allTextContents: async () => cards.map((card) => card.fullText),
    first: () => locator(cards.map((card) => card.fullText)),
    or() {
      return typeahead === "nested" ? { ...items, count: async () => cards.length * 2, nth: (index: number) => items.nth(index % cards.length) } : this;
    },
    nth: (index: number) => ({
      click: async () => { clicks.push(index); },
      locator: (selector: string) => {
        if (selector === 'a[href]') return locator(cards[index].profileHrefs ?? []);
        const field = selector === 'a[href*="/i/chat/"]' ? cards[index].conversationText : undefined;
        return locator(field === undefined ? [] : [field]);
      },
    }),
  };
  return {
    clicks,
    page: {
      url: () => "https://x.com/i/chat",
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
      evaluate: async () => ({ composer: "", messages: observations++ === 0 ? [] : [{ id: "new", text: "hello", sentByMe: true }] }),
      locator: (selector: string) => {
        if (selector === '[data-testid="typeaheadResult"]' && typeahead === "empty") return { ...items, count: async () => 0 };
        return selector === '[data-testid^="dm-conversation-item-"]'
          || selector === '[data-testid="typeaheadResult"]' || selector === '[data-testid="UserCell"]'
          ? items : locator([""]);
      },
    } as unknown as BrowserPage,
  };
}

describe("DM identity fields", () => {
  test("a message mentioning Alice cannot select Bob's conversation", async () => {
    const fixture = identityPage([{ conversationText: "Bob\n1日\nAlice asked a question", fullText: "Bob1日Alice asked a question" }]);
    await expect(openConversation(fixture.page, "Alice")).rejects.toThrow("見つかりません");
    expect(fixture.clicks).toEqual([]);
  });

  test("conversation selection uses the name field even when another preview mentions it", async () => {
    const fixture = identityPage([
      { conversationText: "Bob\n1日\nAlice asked a question", fullText: "Bob1日Alice asked a question" },
      { conversationText: "Alice\n1日\nHello", fullText: "Alice1日Hello" },
    ]);
    await openConversation(fixture.page, "Alice");
    expect(fixture.clicks).toEqual([1]);
  });

  test("missing name fields do not fall back to the conversation preview", async () => {
    const fixture = identityPage([{ fullText: "Alice1日Hello" }]);
    await expect(openConversation(fixture.page, "Alice")).rejects.toThrow("名前領域");
    expect(fixture.clicks).toEqual([]);
  });

  test("a display name mentioning @alice cannot select the @mallory account", async () => {
    const fixture = identityPage([{ profileHrefs: ["/mallory"], fullText: "Ask @alice for support @mallory" }]);
    await expect(send(fixture.page, "alice", "hello")).rejects.toThrow("見つかりません");
    expect(fixture.clicks).toEqual([]);
  });

  test("missing handle fields do not fall back to the display name", async () => {
    const fixture = identityPage([{ fullText: "Ask @alice for support" }]);
    await expect(send(fixture.page, "alice", "hello")).rejects.toThrow("ハンドル領域");
    expect(fixture.clicks).toEqual([]);
  });

  test("a card with conflicting profile handles is never selected", async () => {
    const fixture = identityPage([{ profileHrefs: ["/mallory", "/alice"], fullText: "@alice" }]);
    await expect(send(fixture.page, "alice", "hello")).rejects.toThrow("一意");
    expect(fixture.clicks).toEqual([]);
  });

  test("a profile-shaped path on another host is not an X identity", async () => {
    const fixture = identityPage([{ profileHrefs: ["https://example.com/alice"], fullText: "@alice" }]);
    await expect(send(fixture.page, "alice", "hello")).rejects.toThrow("ハンドル領域");
    expect(fixture.clicks).toEqual([]);
  });

  test.each(["nested", "empty"] as const)("selects one candidate when typeahead is %s", async (typeahead) => {
    const fixture = identityPage([{ profileHrefs: ["/alice"], fullText: "Alice @alice" }], typeahead);
    expect(await send(fixture.page, "alice", "hello")).toMatchObject({ success: true, outcome: "confirmed" });
    expect(fixture.clicks).toEqual([0]);
  });
});

function deliveryPage(snapshots: DeliverySnapshot[]) {
  let observations = 0;
  let submissions = 0;
  const press = async () => { submissions += 1; };
  return {
    get observations() { return observations; },
    get submissions() { return submissions; },
    page: {
      evaluate: async () => snapshots[Math.min(observations++, snapshots.length - 1)],
      waitForTimeout: async () => {},
      keyboard: { press },
      locator: () => ({ waitFor: async () => {}, click: async () => {}, fill: async () => {}, press }),
    } as unknown as BrowserPage,
  };
}

describe("DM send confirmation", () => {
  test("waits for a new outgoing message and an empty composer before reporting success", async () => {
    const fixture = deliveryPage([
      { composer: "", messages: [] },
      { composer: "hello", messages: [] },
      { composer: "", messages: [{ id: "new", text: "hello", sentByMe: true }] },
    ]);
    expect(await compose(fixture.page, "alice", "hello")).toEqual({ success: true, outcome: "confirmed", handle: "@alice", message: "hello" });
    expect(fixture.observations).toBe(3);
    expect(fixture.submissions).toBe(1);
  });

  test.each([
    { name: "old identical message", state: { composer: "", messages: [{ id: "old", text: "hello", sentByMe: true }] } },
    { name: "incoming identical message", state: { composer: "", messages: [{ id: "new", text: "hello", sentByMe: false }] } },
    { name: "uncleared composer", state: { composer: "hello", messages: [{ id: "new", text: "hello", sentByMe: true }] } },
    { name: "different message", state: { composer: "", messages: [{ id: "new", text: "another", sentByMe: true }] } },
  ])("returns unknown for $name without resubmitting", async ({ state }) => {
    const fixture = deliveryPage([
      { composer: "", messages: [{ id: "old", text: "hello", sentByMe: true }] },
      state,
    ]);
    await expect(compose(fixture.page, "alice", "hello")).rejects.toBeInstanceOf(SendOutcomeUnknownError);
    expect(fixture.submissions).toBe(1);
  });
});

async function textFile(text: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "x-dm-test-"));
  directories.push(directory);
  const path = join(directory, "message.txt");
  await writeFile(path, text);
  return path;
}

function harness(options: { failure?: string | Error; closeFailure?: string; stdin?: string } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let loads = 0;
  let closes = 0;
  const result = async (command: string, ...args: string[]) => {
    if (options.failure) throw options.failure instanceof Error ? options.failure : new Error(options.failure);
    return { command, args };
  };
  return {
    stdout,
    stderr,
    get loads() { return loads; },
    get closes() { return closes; },
    dependencies: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      readStdin: async () => options.stdin ?? "",
      loadClient: async () => {
        loads += 1;
        return {
          list: () => result("list"),
          read: (target: string) => result("read", target),
          search: (query: string) => result("search", query),
          send: (handle: string, message: string) => result("send", handle, message),
          reply: (target: string, message: string) => result("reply", target, message),
          close: async () => {
            closes += 1;
            if (options.closeFailure) throw new Error(options.closeFailure);
          },
        };
      },
    },
  };
}

describe("x-dm CLI", () => {
  test("the deployed launcher returns help and input errors without browser dependencies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "x-dm-launcher-"));
    directories.push(directory);
    await mkdir(join(directory, "bin"), { recursive: true });
    await mkdir(join(directory, "lib", "x-dm", "src"), { recursive: true });
    const launcher = join(directory, "bin", "x-dm");
    await copyFile(new URL("../dot_local/bin/executable_x-dm", import.meta.url), launcher);
    await copyFile(new URL("../dot_local/lib/x-dm/src/cli.ts", import.meta.url), join(directory, "lib", "x-dm", "src", "cli.ts"));
    await copyFile(new URL("../dot_local/lib/x-dm/src/delivery.ts", import.meta.url), join(directory, "lib", "x-dm", "src", "delivery.ts"));

    const help = Bun.spawnSync([process.execPath, launcher, "--help"], { cwd: directory });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("x-dm list");
    expect(help.stderr.toString()).toBe("");

    const invalid = Bun.spawnSync([process.execPath, launcher, "read"], { cwd: directory });
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr.toString()).toContain("会話名");
    expect(invalid.stdout.toString()).toBe("");
  });

  test.each([[], ["--help"], ["send", "--help"], ["read", "-h"]].map((argv) => ({ argv })))(
    "help is available without loading Playwright: $argv",
    async ({ argv }) => {
      const io = harness();
      expect(await runCli(argv, io.dependencies)).toBe(0);
      expect(io.stdout.join("\n")).toContain("x-dm list");
      expect(io.stdout.join("\n")).toContain("--text-file");
      expect(io.stderr).toEqual([]);
      expect(io.loads).toBe(0);
    },
  );

  test.each([
    ["list", "extra"], ["read"], ["read", "a", "b"], ["read", "   "],
    ["search"], ["search", " "], ["send", "@name"], ["reply", "name", " "],
    ["send", "bad/name", "hello"], ["send", "@", "hello"],
    ["send", "name", "hello", "--text", "other"],
    ["reply", "name", "--text", "hello", "--text-file", "message.txt"],
    ["send", "name", "--text", "one", "--text", "two"],
    ["list", "--text-file", "message.txt"], ["list", "--unknown"],
    ["send", "name", "--text-file"], ["send", "name", "--text-file", ""],
    ["unknown"],
  ].map((argv) => ({ argv })))("invalid input exits before browser startup: $argv", async ({ argv }) => {
    const io = harness();
    expect(await runCli(argv, io.dependencies)).toBe(2);
    expect(io.stderr.join("\n")).toContain("x-dm:");
    expect(io.stdout).toEqual([]);
    expect(io.loads).toBe(0);
  });

  test("normalizes an @ prefix while retaining Japanese conversation names", () => {
    expect(parseArguments(["read", "@かわうそ"])).toEqual({ command: "read", target: "かわうそ" });
  });

  test.each([
    { argv: ["list"], result: { command: "list", args: [] } },
    { argv: ["read", "@name"], result: { command: "read", args: ["name"] } },
    { argv: ["search", "two", "words"], result: { command: "search", args: ["two words"] } },
    { argv: ["send", "@name", "hello", "there"], result: { command: "send", args: ["name", "hello there"] } },
    { argv: ["reply", "かわうそ", "--text", "first\nsecond"], result: { command: "reply", args: ["かわうそ", "first\nsecond"] } },
    { argv: ["send", "name", "--", "--hello"], result: { command: "send", args: ["name", "--hello"] } },
  ])("dispatches $argv and closes the browser", async ({ argv, result }) => {
    const io = harness();
    expect(await runCli(argv, io.dependencies)).toBe(0);
    expect(JSON.parse(io.stdout.join("\n"))).toEqual(result);
    expect(io.stderr).toEqual([]);
    expect(io.loads).toBe(1);
    expect(io.closes).toBe(1);
  });

  test("--text-file preserves newlines, quotes, and trailing whitespace", async () => {
    const path = await textFile("first\n\"second\" $literal `literal`\n");
    const io = harness();
    expect(await runCli(["send", "name", "--text-file", path], io.dependencies)).toBe(0);
    expect(JSON.parse(io.stdout[0])).toEqual({ command: "send", args: ["name", "first\n\"second\" $literal `literal`\n"] });
  });

  test("--text-file - reads stdin without changing the body", async () => {
    const io = harness({ stdin: "first\nsecond\n" });
    expect(await runCli(["reply", "name", "--text-file", "-"], io.dependencies)).toBe(0);
    expect(JSON.parse(io.stdout[0])).toEqual({ command: "reply", args: ["name", "first\nsecond\n"] });
  });

  test("an empty body file does not start a browser", async () => {
    const path = await textFile(" \n\t");
    const io = harness();
    expect(await runCli(["send", "name", "--text-file", path], io.dependencies)).toBe(2);
    expect(io.loads).toBe(0);
    expect(io.stderr.join("\n")).toContain("本文");
  });

  test("an unreadable body file does not start a browser", async () => {
    const directory = await mkdtemp(join(tmpdir(), "x-dm-missing-"));
    directories.push(directory);
    const io = harness();
    expect(await runCli(["reply", "name", "--text-file", join(directory, "missing.txt")], io.dependencies)).toBe(2);
    expect(io.loads).toBe(0);
    expect(io.stderr.join("\n")).toContain("読み込めません");
  });

  test("a send failure returns a nonzero exit code and closes the browser", async () => {
    const io = harness({ failure: "送信できません" });
    expect(await runCli(["send", "name", "hello"], io.dependencies)).toBe(1);
    expect(io.stdout).toEqual([]);
    expect(io.stderr.join("\n")).toContain("送信できません");
    expect(io.closes).toBe(1);
  });

  test("a cleanup failure preserves a successful send result and exit code", async () => {
    const io = harness({ closeFailure: "close failed" });
    expect(await runCli(["send", "name", "hello"], io.dependencies)).toBe(0);
    expect(JSON.parse(io.stdout[0])).toEqual({ command: "send", args: ["name", "hello"] });
    expect(io.stderr.join("\n")).toContain("警告");
    expect(io.stderr.join("\n")).toContain("close failed");
  });

  test("a cleanup failure does not replace the original operation error", async () => {
    const io = harness({ failure: "送信できません", closeFailure: "close failed" });
    expect(await runCli(["reply", "name", "hello"], io.dependencies)).toBe(1);
    expect(io.stderr.join("\n")).toContain("送信できません");
    expect(io.stderr.join("\n")).toContain("close failed");
    expect(io.stdout).toEqual([]);
  });

  test("an uncertain send returns JSON outcome unknown and a distinct exit code", async () => {
    const io = harness({ failure: new SendOutcomeUnknownError("name", "hello"), closeFailure: "close failed" });
    expect(await runCli(["send", "name", "hello"], io.dependencies)).toBe(3);
    expect(JSON.parse(io.stdout[0])).toMatchObject({ success: false, outcome: "unknown", handle: "@name", message: "hello" });
    expect(io.stderr.join("\n")).toContain("再送せず");
    expect(io.closes).toBe(1);
  });

  test("a startup failure returns an actionable error", async () => {
    const io = harness();
    const dependencies = {
      ...io.dependencies,
      loadClient: async () => { throw new Error("Chrome が起動できません"); },
    };
    expect(await runCli(["list"], dependencies)).toBe(1);
    expect(io.stderr.join("\n")).toContain("Chrome が起動できません");
    expect(io.stdout).toEqual([]);
  });
});
