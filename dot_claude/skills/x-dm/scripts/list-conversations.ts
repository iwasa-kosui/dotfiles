import {
  launchBrowser,
  closeBrowser,
  navigateToDM,
  SELECTORS,
  outputJSON,
} from "./shared.ts";

interface Conversation {
  id: string;
  name: string;
  lastMessage: string;
  timestamp: string;
}

const TIMESTAMP_RE = /(\d+(?:秒|分|時間|日|週間|か月|年))/;

async function main() {
  const { context, page } = await launchBrowser();

  try {
    await navigateToDM(page);

    const items = page.locator(SELECTORS.conversationItem);
    await items.first().waitFor({ timeout: 10_000 }).catch(() => {});

    const count = await items.count();
    const results: Conversation[] = [];

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);

      const link = item.locator('a[href*="/i/chat/"]');
      const href = (await link.first().getAttribute("href")) ?? "";
      const id = href.replace("/i/chat/", "");
      const fullText = (await link.first().textContent()) ?? "";

      const match = fullText.match(TIMESTAMP_RE);
      let name = "";
      let timestamp = "";
      let lastMessage = "";

      if (match && match.index !== undefined) {
        name = fullText.slice(0, match.index).trim();
        timestamp = match[1];
        lastMessage = fullText.slice(match.index + match[0].length).trim();
      } else {
        name = fullText.trim();
      }

      results.push({ id, name, lastMessage, timestamp });
    }

    outputJSON(results);
  } finally {
    await closeBrowser(context);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
