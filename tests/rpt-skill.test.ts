import { expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const skillPaths = [
  "dot_codex/skills/rpt/SKILL.md",
  "dot_claude/skills/rpt/SKILL.md",
  "dot_cursor/skills/rpt/SKILL.md",
].map((path) => join(root, path));

test("rpt skill is identical across Codex Claude and Cursor", async () => {
  const contents = await Promise.all(skillPaths.map((path) => Bun.file(path).text()));
  expect(contents[1]).toBe(contents[0]);
  expect(contents[2]).toBe(contents[0]);
});

test("rpt skill discovers report creation and uses the live CLI contract", async () => {
  const skill = await Bun.file(skillPaths[0]).text();
  expect(skill).toMatch(/^---\nname: rpt\ndescription: Use when /);
  expect(skill).toContain("レポート");
  expect(skill).toContain("HTML");
  expect(skill).toContain("MDX");
  expect(skill).toContain("mobile-preview-url");
  expect(skill).toContain("Run `rpt` without arguments");
  expect(skill).toContain("Treat stdout as the authoritative authoring contract");
  expect(skill).toContain("rpt build");
  expect(skill).toContain("exit code 3");
  expect(skill).toContain("exit code 4");
  expect(skill).toContain("If `rpt` is unavailable");
  expect(skill).toContain("If the authoring contract cannot be read");
  expect(skill).toContain("dedicated preview directory");
});

test("rpt skill gates MDX authoring on a successful live contract run", async () => {
  const skill = await Bun.file(skillPaths[0]).text();
  expect(skill).toContain("Run `rpt` without arguments in this task before writing any MDX");
  expect(skill).toContain("Do not write MDX or proceed until this run succeeds");
  expect(skill).toContain("never from memory");
});

test("rpt skill authorizes and verifies a requested phone preview", async () => {
  const skill = await Bun.file(skillPaths[0]).text();
  expect(skill).toContain(
    "Treat the request itself as authorization to start the dedicated local server",
  );
  expect(skill).toContain("Do not ask for additional confirmation");
  expect(skill).toContain("Choose an unused port");
  expect(skill).toContain("If it is occupied, choose another");
  expect(skill).toContain(
    "Verify the bind and server working directory or a successful HTTP response",
  );
  expect(skill).toContain(
    "before running `mobile-preview-url <port>` and returning its URL",
  );
});

test("rpt skill hands off live contract execution evidence", async () => {
  const skill = await Bun.file(skillPaths[0]).text();
  expect(skill).toContain("Include brief execution evidence for the live contract run");
  expect(skill).toContain("command `rpt`");
  expect(skill).toContain("exit status `0`");
});

test("rpt skill distinguishes LAN consent from execution-tool approval", async () => {
  const skill = await Bun.file(skillPaths[0]).text();
  expect(skill).toContain(
    "explicit user approval to share only this generated HTML file on the LAN",
  );
  expect(skill).toContain("Do not ask for additional confirmation because of report content");
  expect(skill).toContain("Do not bypass system or tool approval");
  expect(skill).toContain("use the execution tool's approval mechanism");
  expect(skill).toContain("If approval is refused");
  expect(skill).toContain("server is not running and return no URL");
});

test("rpt skill returns only a verified live preview URL", async () => {
  const skill = await Bun.file(skillPaths[0]).text();
  expect(skill).toContain("Never return a planned URL");
  expect(skill).toContain(
    "Return a URL only after verifying the server process and working directory or an HTTP 200 response",
  );
});

test("Codex rpt skill exposes matching UI metadata", async () => {
  const metadata = await Bun.file(
    join(root, "dot_codex/skills/rpt/agents/openai.yaml"),
  ).text();
  expect(metadata).toContain('display_name: "rpt Reports"');
  expect(metadata).toContain('short_description: "安全な単一HTMLレポートを作成してモバイルプレビュー"');
  expect(metadata).toContain("$rpt");
});
