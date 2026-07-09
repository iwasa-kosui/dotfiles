import {
  launchBrowser,
  closeBrowser,
  navigateToDM,
  SELECTORS,
  outputJSON,
} from "./shared.ts";

async function main() {
  const handle = process.argv[2];
  const message = process.argv.slice(3).join(" ");

  if (!handle || !message) {
    console.error("Usage: bun send.ts <handle> <message>");
    process.exit(1);
  }

  const cleanHandle = handle.replace(/^@/, "");
  const { context, page } = await launchBrowser();

  try {
    await navigateToDM(page);

    const newChatBtn = page.locator(SELECTORS.newChatButton);
    await newChatBtn.waitFor({ timeout: 10_000 });
    await newChatBtn.click();
    await page.waitForTimeout(1000);

    // ユーザー検索
    const searchInput = page.locator(
      'input[placeholder*="検索"], input[placeholder*="Search"], input[aria-label*="検索"], input[aria-label*="Search"]'
    );
    await searchInput.first().waitFor({ timeout: 10_000 });
    await searchInput.first().fill(cleanHandle);
    await page.waitForTimeout(2000);

    // 検索結果から選択
    const userResult = page
      .locator(SELECTORS.typeaheadResult)
      .or(page.locator(SELECTORS.userCell));
    await userResult.first().waitFor({ timeout: 10_000 });
    await userResult.first().click();
    await page.waitForTimeout(500);

    // 「次へ」ボタン
    const nextBtn = page.locator(
      'button:has-text("Next"), button:has-text("次へ"), [data-testid="nextButton"]'
    );
    await nextBtn.first().waitFor({ timeout: 5_000 });
    await nextBtn.first().click();
    await page.waitForTimeout(1000);

    // メッセージ入力・送信
    const textarea = page.locator(SELECTORS.composerTextarea);
    await textarea.waitFor({ timeout: 10_000 });
    await textarea.click();
    await textarea.fill(message);
    await page.waitForTimeout(500);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    outputJSON({
      success: true,
      handle: `@${cleanHandle}`,
      message,
    });
  } catch (err) {
    outputJSON({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await closeBrowser(context);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
