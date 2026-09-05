import { parseArgs } from "node:util";
import { resolve, extname } from "node:path";

export async function startPreview(path: string, port: number, hostname = "0.0.0.0") {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("port must be 0..65535");
  const file = Bun.file(path);
  if (!/\.html?$/i.test(extname(path)) || !(await file.exists())) throw new Error("Choose an existing HTML report");
  // Keep a snapshot of this report; never expose its containing directory.
  const html = await file.arrayBuffer();
  return Bun.serve({
    hostname, port,
    fetch(request) {
      if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      const path = new URL(request.url).pathname;
      if (path !== "/" && path !== "/index.html") return new Response(null, { status: 404 });
      return new Response(request.method === "HEAD" ? null : html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    },
  });
}

export async function runPreview(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: rpt preview <report.html> [--port <0..65535>]\nServe only this report on 0.0.0.0. Default port: an available port.\nPrint the verified Meshnet URL using mobile-preview-url. Stop with Ctrl-C.");
    return 0;
  }
  let server: Awaited<ReturnType<typeof startPreview>> | undefined;
  try {
    const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: { port: { type: "string" } } });
    if (positionals.length !== 1) throw new Error("Usage: rpt preview <report.html> [--port <port>]");
    const port = values.port === undefined ? 0 : Number(values.port);
    server = await startPreview(resolve(positionals[0]), port);
    const response = await fetch(`http://127.0.0.1:${server.port}/index.html`);
    await response.arrayBuffer();
    if (response.status !== 200) throw new Error("Preview verification failed");
    const url = Bun.spawnSync(["mobile-preview-url", String(server.port)], { stdout: "pipe", stderr: "pipe" });
    if (url.exitCode !== 0) throw new Error(url.stderr.toString() || "mobile-preview-url failed");
    console.log(url.stdout.toString().trim());
    return 0;
  } catch (error) {
    server?.stop(true);
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}
