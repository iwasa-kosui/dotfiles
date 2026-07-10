import {
  launchBrowser,
  closeBrowser,
  openConversation,
  SELECTORS,
  outputJSON,
} from "./shared.ts";

interface Message {
  sender: string;
  text: string;
  timestamp: string;
}

async function main() {
  const handle = process.argv[2];
  if (!handle) {
    console.error("Usage: bun read-conversation.ts <handle>");
    process.exit(1);
  }

  const { context, page } = await launchBrowser();

  try {
    await openConversation(page, handle);

    const messageItems = page.locator(SELECTORS.messageItem);
    await messageItems.first().waitFor({ timeout: 10_000 }).catch(() => {});

    const count = await messageItems.count();
    const messages: Message[] = [];

    for (let i = 0; i < count; i++) {
      const item = messageItems.nth(i);
      const testId = (await item.getAttribute("data-testid")) ?? "";
      const msgId = testId.replace("message-", "");

      const textEl = page.locator(`[data-testid="message-text-${msgId}"]`);
      if ((await textEl.count()) === 0) continue;

      const spans = textEl.locator("span[dir='auto']");
      const spanTexts: string[] = [];
      const spanCount = await spans.count();
      for (let j = 0; j < spanCount; j++) {
        const t = (await spans.nth(j).textContent()) ?? "";
        if (t.trim()) spanTexts.push(t.trim());
      }
      const text = spanTexts.join("\n") || ((await textEl.textContent()) ?? "").trim();
      if (!text) continue;

      const timeEl = item.locator("time");
      let timestamp = "";
      if ((await timeEl.count()) > 0) {
        timestamp =
          (await timeEl.first().getAttribute("datetime")) ??
          (await timeEl.first().textContent()) ??
          "";
      }

      // 送信者判定: 右寄せ（自分）か左寄せ（相手）か
      const isSentByMe = await item.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const parent = el.closest('[data-testid="dm-message-list"]');
        if (!parent) return false;
        const parentRect = parent.getBoundingClientRect();
        return rect.left > parentRect.left + parentRect.width * 0.3;
      });

      messages.push({
        sender: isSentByMe ? "@me" : `@${handle.replace(/^@/, "")}`,
        text,
        timestamp,
      });
    }

    outputJSON({
      handle: `@${handle.replace(/^@/, "")}`,
      messages,
    });
  } finally {
    await closeBrowser(context);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
