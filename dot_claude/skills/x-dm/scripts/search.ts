import {
  launchBrowser,
  closeBrowser,
  navigateToDM,
  SELECTORS,
  outputJSON,
} from "./shared.ts";

interface SearchResult {
  id: string;
  name: string;
  matchedText: string;
}

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("Usage: bun search.ts <query>");
    process.exit(1);
  }

  const { context, page } = await launchBrowser();

  try {
    await navigateToDM(page);

    const searchBar = page.locator(SELECTORS.searchBar);
    await searchBar.waitFor({ timeout: 10_000 });

    const searchInput = searchBar.locator("input");
    await searchInput.click();
    await searchInput.fill(query);
    await page.waitForTimeout(2000);

    const results: SearchResult[] = [];

    // 検索結果の会話アイテムを取得
    const items = page.locator(SELECTORS.conversationItem);
    const count = await items.count();

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const link = item.locator('a[href*="/i/chat/"]');
      const href = (await link.first().getAttribute("href")) ?? "";
      const id = href.replace("/i/chat/", "");
      const fullText = (await link.first().textContent()) ?? "";

      const TIMESTAMP_RE = /(\d+(?:秒|分|時間|日|週間|か月|年))/;
      const match = fullText.match(TIMESTAMP_RE);
      let name = "";
      let matchedText = "";

      if (match && match.index !== undefined) {
        name = fullText.slice(0, match.index).trim();
        matchedText = fullText.slice(match.index + match[0].length).trim();
      } else {
        name = fullText.trim();
      }

      results.push({ id, name, matchedText });
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
