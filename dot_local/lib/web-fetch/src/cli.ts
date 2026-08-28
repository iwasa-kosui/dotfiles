import { loadAllowlist } from "./allowlist.ts";
import { fetchAllowed } from "./fetch.ts";
import { render } from "./markdown.ts";

const usage = "usage: web-fetch <url>";

export async function runCli(argv: readonly string[]): Promise<number> {
  if (argv.length !== 1) {
    console.error(usage);
    return 3;
  }

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
