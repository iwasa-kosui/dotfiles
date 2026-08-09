import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAstroBuildCommand } from "../dot_local/lib/rpt/src/astro-command.ts";

test("Astro build command runs a package script without its executable bit", async () => {
  const root = await mkdtemp(join(tmpdir(), "rpt-astro-command-"));
  const script = join(root, "node_modules/astro/astro.js");
  try {
    await mkdir(join(root, "node_modules/astro"), { recursive: true });
    await writeFile(script, 'console.log(process.argv[2]);\n');
    await chmod(script, 0o644);

    const process = Bun.spawn([...createAstroBuildCommand(root)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await process.exited).toBe(0);
    expect(await new Response(process.stdout).text()).toBe("build\n");
    expect(await new Response(process.stderr).text()).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
