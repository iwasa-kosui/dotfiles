const usage = `Usage: web-fetch <url>

Fetch an allowed public URL and write its complete Markdown content to stdout.
HTML navigation and scripts are removed. JSON, Markdown and plain text are preserved.
Redirects are checked against the allowlist at each hop.
Allowlist: ~/.config/web-fetch/allowlist (managed with chezmoi).
Exit codes: 0 success, 1 HTTP/network error, 2 allowlist rejection, 3 invalid arguments.
`;

export async function runCli(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || (argv.length === 1 && ["--help", "-h"].includes(argv[0]))) {
    console.log(usage);
    return 0;
  }
  if (argv.length !== 1) {
    console.error(usage);
    return 3;
  }

  const [{ loadAllowlist }, { fetchAllowed }, { render }] = await Promise.all([
    import("./allowlist.ts"), import("./fetch.ts"), import("./markdown.ts"),
  ]);
  const allowlist = await loadAllowlist();
  const outcome = await fetchAllowed(argv[0], { allowlist });

  switch (outcome.kind) {
    case "ok":
      console.log(render(outcome.body, outcome.contentType));
      return 0;
    case "rejected":
      console.error(outcome.reason);
      console.error("許可されているドメイン:");
      for (const entry of allowlist) {
        console.error(`  ${entry}`);
      }
      return 2;
    case "http-error":
      console.error(`HTTPエラー: ${outcome.status} ${outcome.url}`);
      return 1;
    case "network-error":
      console.error(`ネットワークエラー: ${outcome.message}`);
      return 1;
  }
}
