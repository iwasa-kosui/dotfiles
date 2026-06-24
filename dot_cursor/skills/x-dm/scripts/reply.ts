import {
  launchBrowser,
  closeBrowser,
  openConversation,
  SELECTORS,
  outputJSON,
} from "./shared.ts";

async function main() {
  const handle = process.argv[2];
  const message = process.argv.slice(3).join(" ");

  if (!handle || !message) {
    console.error("Usage: bun reply.ts <handle> <message>");
    process.exit(1);
  }

  const { context, page } = await launchBrowser();

  try {
    await openConversation(page, handle);

    const textarea = page.locator(SELECTORS.composerTextarea);
    await textarea.waitFor({ timeout: 10_000 });
    await textarea.click();
    await textarea.fill(message);
    await page.waitForTimeout(500);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    outputJSON({
      success: true,
      handle: `@${handle.replace(/^@/, "")}`,
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
