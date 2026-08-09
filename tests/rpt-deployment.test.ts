import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

async function run(command: string[]): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

test("rpt deployment excludes generated files, materializes SCSS, and forces dependency repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "rpt-deployment-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(destination, { recursive: true });
    await mkdir(join(source, "dot_local/lib/rpt/node_modules/astro"), {
      recursive: true,
    });
    await mkdir(join(source, "dot_local/lib/rpt/template/.astro"), {
      recursive: true,
    });
    await mkdir(join(source, "dot_local/lib/rpt/template/.astro-cache"), {
      recursive: true,
    });
    await mkdir(join(source, "dot_local/lib/rpt/template/.vite-cache"), {
      recursive: true,
    });
    await Promise.all([
      cp(
        join(repositoryRoot, ".chezmoiignore"),
        join(source, ".chezmoiignore"),
      ),
      writeFile(
        join(source, "dot_local/lib/rpt/node_modules/astro/astro.js"),
        "generated dependency\n",
      ),
      writeFile(
        join(source, "dot_local/lib/rpt/template/.astro/types.d.ts"),
        "generated Astro cache\n",
      ),
      writeFile(
        join(source, "dot_local/lib/rpt/template/.astro-cache/data-store.json"),
        "{}\n",
      ),
      writeFile(
        join(source, "dot_local/lib/rpt/template/.vite-cache/deps.json"),
        "{}\n",
      ),
    ]);

    const ignore = await Bun.file(join(source, ".chezmoiignore")).text();
    expect(ignore).toContain(".local/lib/rpt/node_modules");
    expect(ignore).toContain(".local/lib/rpt/template/.astro");
    expect(ignore).toContain(".local/lib/rpt/template/.astro-cache");
    expect(ignore).toContain(".local/lib/rpt/template/.vite-cache");

    const managed = await run([
      "chezmoi",
      "managed",
      "-S",
      source,
      "-D",
      destination,
      "--path-style",
      "source-relative",
    ]);
    expect(managed.exitCode).toBe(0);
    expect(managed.stdout).not.toContain(
      "dot_local/lib/rpt/node_modules/astro/astro.js",
    );
    expect(managed.stdout).not.toContain(
      "dot_local/lib/rpt/template/.astro/types.d.ts",
    );
    expect(managed.stdout).not.toContain(
      "dot_local/lib/rpt/template/.astro-cache/data-store.json",
    );
    expect(managed.stdout).not.toContain(
      "dot_local/lib/rpt/template/.vite-cache/deps.json",
    );

    const webcoreConfig = join(
      destination,
      ".local/lib/rpt/template/webcore.config.scss",
    );
    const applied = await run([
      "chezmoi",
      "apply",
      "-S",
      repositoryRoot,
      "-D",
      destination,
      "--persistent-state",
      join(root, "chezmoistate.boltdb"),
      "--force",
      "--parent-dirs",
      webcoreConfig,
    ]);
    expect(applied.exitCode).toBe(0);
    expect(await Bun.file(webcoreConfig).text()).not.toBe("");

    const installHook = await Bun.file(
      join(repositoryRoot, "run_onchange_after_install-rpt-dependencies.sh.tmpl"),
    ).text();
    expect(installHook).toContain("bun install --frozen-lockfile --force");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
