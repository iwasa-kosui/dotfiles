import type { Locator, Page } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DMClient } from "./cli.ts";
import { findConversationIndex, findRecipientIndex, parseConversation } from "./conversation.ts";
import { SendOutcomeUnknownError, type DeliverySnapshot } from "./delivery.ts";

const PROFILE_DIR = join(homedir(), ".playwright", "x-dm");
const AUTH_TIMEOUT = 5 * 60 * 1000;
const NAV_TIMEOUT = 30_000;
const DM_URL = "https://x.com/i/chat";

const SELECTORS = {
  conversationItem: '[data-testid^="dm-conversation-item-"]',
  newChatButton: '[data-testid="dm-new-chat-button"]',
  searchBar: '[data-testid="dm-search-bar"]',
  composerTextarea: '[data-testid="dm-composer-textarea"]',
  messageItem: '[data-testid^="message-"]:not([data-testid*="text"]):not([data-testid*="list"])',
  messageText: '[data-testid^="message-text-"]',
  userCell: '[data-testid="UserCell"]',
  typeaheadResult: '[data-testid="typeaheadResult"]',
} as const;

async function conversationNames(items: Locator): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0, count = await items.count(); i < count; i++) {
    const link = items.nth(i).locator('a[href*="/i/chat/"]').first();
    if (await link.count() !== 1) throw new Error("会話の名前領域を特定できません");
    const firstLine = (await link.innerText()).split(/\r?\n/, 1)[0].trim();
    const name = parseConversation("", firstLine).name;
    if (!name) throw new Error("会話の名前領域が空です。宛先を確認できません");
    names.push(name);
  }
  return names;
}

async function recipientHandles(items: Locator): Promise<string[]> {
  const handles: string[] = [];
  for (let i = 0, count = await items.count(); i < count; i++) {
    const links = items.nth(i).locator("a[href]");
    const candidates = new Set<string>();
    for (let j = 0, count = await links.count(); j < count; j++) {
      const href = await links.nth(j).getAttribute("href");
      if (!href) continue;
      let url: URL;
      try { url = new URL(href, DM_URL); } catch { continue; }
      if (!["https:", "http:"].includes(url.protocol) || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) continue;
      const handle = url.pathname.match(/^\/([A-Za-z0-9_]+)\/?$/)?.[1];
      if (handle) candidates.add(`@${handle.toLowerCase()}`);
    }
    if (candidates.size !== 1) throw new Error("プロフィールリンクからハンドル領域を一意に特定できません");
    handles.push([...candidates][0]);
  }
  return handles;
}

async function navigateToDM(page: Page): Promise<void> {
  if (!page.url().includes("/i/chat")) {
    await page.goto(DM_URL, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(1500);
}

export async function openConversation(page: Page, target: string): Promise<void> {
  await navigateToDM(page);
  const items = page.locator(SELECTORS.conversationItem);
  const names = await conversationNames(items);
  const index = findConversationIndex(names, target);
  await items.nth(index).click();
  await page.waitForTimeout(2000);
}

async function list(page: Page) {
  await navigateToDM(page);
  const items = page.locator(SELECTORS.conversationItem);
  await items.first().waitFor({ timeout: 10_000 }).catch(() => {});
  const conversations = [];
  for (let i = 0, count = await items.count(); i < count; i++) {
    const link = items.nth(i).locator('a[href*="/i/chat/"]').first();
    conversations.push(parseConversation(
      (await link.getAttribute("href")) ?? "",
      (await link.textContent()) ?? "",
    ));
  }
  return conversations;
}

async function read(page: Page, target: string) {
  await openConversation(page, target);
  const items = page.locator(SELECTORS.messageItem);
  await items.first().waitFor({ timeout: 10_000 }).catch(() => {});
  const messages = [];
  for (let i = 0, count = await items.count(); i < count; i++) {
    const item = items.nth(i);
    const messageId = ((await item.getAttribute("data-testid")) ?? "").replace("message-", "");
    const textElement = page.locator(`[data-testid="message-text-${messageId}"]`);
    if ((await textElement.count()) === 0) continue;

    const spanTexts = (await textElement.locator("span[dir='auto']").allTextContents())
      .map((text) => text.trim()).filter(Boolean);
    const text = spanTexts.join("\n") || ((await textElement.textContent()) ?? "").trim();
    if (!text) continue;

    const time = item.locator("time").first();
    const timestamp = await time.count()
      ? (await time.getAttribute("datetime")) ?? (await time.textContent()) ?? ""
      : "";
    // 既存UIには送信者属性がないため、吹き出しの右寄せで判定する。
    const sentByMe = await item.evaluate((element) => {
      const parent = element.closest('[data-testid="dm-message-list"]');
      if (!parent) return false;
      const rect = parent.getBoundingClientRect();
      return element.getBoundingClientRect().left > rect.left + rect.width * 0.3;
    });
    messages.push({ sender: sentByMe ? "@me" : `@${target}`, text, timestamp });
  }
  return { handle: `@${target}`, messages };
}

async function search(page: Page, query: string) {
  await navigateToDM(page);
  const searchBar = page.locator(SELECTORS.searchBar);
  await searchBar.waitFor({ timeout: 10_000 });
  const input = searchBar.locator("input");
  await input.click();
  await input.fill(query);
  await page.waitForTimeout(2000);

  const items = page.locator(SELECTORS.conversationItem);
  const results = [];
  for (let i = 0, count = await items.count(); i < count; i++) {
    const link = items.nth(i).locator('a[href*="/i/chat/"]').first();
    const conversation = parseConversation(
      (await link.getAttribute("href")) ?? "",
      (await link.textContent()) ?? "",
    );
    results.push({ id: conversation.id, name: conversation.name, matchedText: conversation.lastMessage });
  }
  return results;
}

async function deliverySnapshot(page: Page): Promise<DeliverySnapshot> {
  return page.evaluate((selectors) => {
    const composer = document.querySelector<HTMLTextAreaElement>(selectors.composerTextarea);
    const messages = Array.from(document.querySelectorAll<HTMLElement>(selectors.messageText)).map((element) => {
      const row = element.closest(selectors.messageItem);
      const list = row?.closest('[data-testid="dm-message-list"]');
      const listRect = list?.getBoundingClientRect();
      return {
        id: element.getAttribute("data-testid") ?? "",
        text: element.innerText,
        sentByMe: Boolean(row && listRect && listRect.width > 0 && row.getBoundingClientRect().left > listRect.left + listRect.width * 0.3),
      };
    });
    return { composer: composer?.value ?? null, messages };
  }, SELECTORS);
}

export async function compose(page: Page, target: string, message: string) {
  const textarea = page.locator(SELECTORS.composerTextarea);
  await textarea.waitFor({ timeout: 10_000 });
  const previousIds = new Set((await deliverySnapshot(page)).messages.map((item) => item.id));
  await textarea.click();
  await textarea.fill(message);
  const expected = message.replace(/\r\n/g, "\n").trim();
  try {
    await textarea.press("Enter");
    for (let attempt = 0; attempt < 40; attempt++) {
      const state = await deliverySnapshot(page);
      if (state.composer === "" && state.messages.some((item) =>
        item.id && !previousIds.has(item.id) && item.sentByMe && item.text.replace(/\r\n/g, "\n").trim() === expected,
      )) {
        return { success: true, outcome: "confirmed", handle: `@${target}`, message };
      }
      await page.waitForTimeout(250);
    }
  } catch {
    // Enter 後の失敗は未送信とは限らないため、自動で再送しない。
  }
  throw new SendOutcomeUnknownError(target, message);
}

export async function send(page: Page, handle: string, message: string) {
  await navigateToDM(page);
  const newChatButton = page.locator(SELECTORS.newChatButton);
  await newChatButton.waitFor({ timeout: 10_000 });
  await newChatButton.click();
  await page.waitForTimeout(1000);

  const input = page.locator(
    'input[placeholder*="検索"], input[placeholder*="Search"], input[aria-label*="検索"], input[aria-label*="Search"]',
  ).first();
  await input.waitFor({ timeout: 10_000 });
  await input.fill(handle);
  await page.waitForTimeout(2000);

  const typeahead = page.locator(SELECTORS.typeaheadResult);
  const users = await typeahead.count() > 0 ? typeahead : page.locator(SELECTORS.userCell);
  await users.first().waitFor({ timeout: 10_000 });
  const handles = await recipientHandles(users);
  const index = findRecipientIndex(handles, handle);
  await users.nth(index).click();
  await page.waitForTimeout(500);

  const nextButton = page.locator(
    'button:has-text("Next"), button:has-text("次へ"), [data-testid="nextButton"]',
  ).first();
  await nextButton.waitFor({ timeout: 5_000 });
  await nextButton.click();
  await page.waitForTimeout(1000);
  return compose(page, handle, message);
}

export async function createClient(): Promise<DMClient> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error("Playwright を読み込めません。~/.local/lib/x-dm で bun install --frozen-lockfile を実行してください");
  }
  const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
  });

  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);
    await page.goto(DM_URL, { waitUntil: "load", timeout: NAV_TIMEOUT });
    await page.waitForTimeout(3000);
    const url = page.url();
    if (!url.includes("/i/chat") || url.includes("login") || url.includes("onboarding")) {
      console.error("ブラウザでX.comにログインしてください。ログイン完了まで待機します...");
      await page.waitForURL((url) => url.pathname.startsWith("/i/chat"), { timeout: AUTH_TIMEOUT });
    }
    await page.waitForSelector(SELECTORS.conversationItem, { timeout: NAV_TIMEOUT }).catch(() => {});
    return {
      list: () => list(page),
      read: (target) => read(page, target),
      search: (query) => search(page, query),
      send: (handle, message) => send(page, handle, message),
      reply: async (target, message) => {
        await openConversation(page, target);
        return compose(page, target, message);
      },
      close: () => context.close(),
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}
