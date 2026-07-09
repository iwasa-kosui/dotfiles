import { chromium, type BrowserContext, type Page } from "playwright";
import { homedir } from "os";
import { join } from "path";

const PROFILE_DIR = join(homedir(), ".playwright", "x-dm");
const AUTH_TIMEOUT = 5 * 60 * 1000;
const NAV_TIMEOUT = 30_000;
const DM_URL = "https://x.com/i/chat";

export const SELECTORS = {
  dmContainer: '[data-testid="dm-container"]',
  inboxPanel: '[data-testid="dm-inbox-panel"]',
  conversationItem: '[data-testid^="dm-conversation-item-"]',
  conversationPanel: '[data-testid="dm-conversation-panel"]',
  newChatButton: '[data-testid="dm-new-chat-button"]',
  searchBar: '[data-testid="dm-search-bar"]',
  composerTextarea: '[data-testid="dm-composer-textarea"]',
  composerForm: '[data-testid="dm-composer-form"]',
  messageList: '[data-testid="dm-message-list"]',
  messageItem: '[data-testid^="message-"]:not([data-testid*="text"]):not([data-testid*="list"])',
  messageText: '[data-testid^="message-text-"]',
  userCell: '[data-testid="UserCell"]',
  typeaheadResult: '[data-testid="typeaheadResult"]',
} as const;

export async function launchBrowser(): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(NAV_TIMEOUT);

  await page.goto(DM_URL, { waitUntil: "load", timeout: NAV_TIMEOUT });
  await page.waitForTimeout(3000);

  const url = page.url();
  const needsLogin =
    !url.includes("/i/chat") ||
    url.includes("login") ||
    url.includes("onboarding");

  if (needsLogin) {
    console.error(
      "ブラウザでX.comにログインしてください。ログイン完了まで待機します..."
    );
    await page.waitForURL((u) => new URL(u).pathname.startsWith("/i/chat"), {
      timeout: AUTH_TIMEOUT,
    });
  }

  await page
    .waitForSelector(SELECTORS.conversationItem, { timeout: NAV_TIMEOUT })
    .catch(() => {});

  return { context, page };
}

export async function closeBrowser(context: BrowserContext): Promise<void> {
  await context.close();
}

export async function navigateToDM(page: Page): Promise<void> {
  if (!page.url().includes("/i/chat")) {
    await page.goto(DM_URL, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(1500);
}

export async function openConversation(
  page: Page,
  handle: string
): Promise<void> {
  const cleanHandle = handle.replace(/^@/, "");

  await navigateToDM(page);

  const items = page.locator(SELECTORS.conversationItem);
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).textContent()) ?? "";
    if (text.toLowerCase().includes(cleanHandle.toLowerCase())) {
      await items.nth(i).click();
      await page.waitForTimeout(2000);
      return;
    }
  }

  throw new Error(`会話が見つかりません: @${cleanHandle}`);
}

export function outputJSON(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
