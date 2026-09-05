import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("preview serves only the chosen HTML file and rejects unrelated routes", async () => {
  const { startPreview } = await import("../dot_local/lib/rpt/src/preview.ts");
  const dir = mkdtempSync(join(tmpdir(), "rpt-preview-test-"));
  writeFileSync(join(dir, "report.html"), "<h1>Report</h1>");
  writeFileSync(join(dir, "private.txt"), "not for serving");
  const server = await startPreview(join(dir, "report.html"), 0, "127.0.0.1");
  try {
    const root = `http://127.0.0.1:${server.port}`;
    const response = await fetch(root);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>Report</h1>");
    expect((await fetch(`${root}/index.html`)).status).toBe(200);
    expect((await fetch(`${root}/private.txt`)).status).toBe(404);
    expect((await fetch(root, { method: "POST" })).status).toBe(405);
  } finally { server.stop(true); rmSync(dir, { recursive: true, force: true }); }
});
