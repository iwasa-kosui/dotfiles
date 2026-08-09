export type BridgeArgs = { branch: string };

export function parseBridgeArgs(args: string[]): BridgeArgs | undefined {
  if (args.length !== 2 || args[0] !== "open") return undefined;
  return { branch: args[1] };
}

export function buildRemoteCommand(server: string, cwd: string, branch: string): string[] {
  const payload = Buffer.from(JSON.stringify({ cwd, branch }), "utf8").toString("base64");
  const expression =
    `luaeval("require('user.pr_review').receive(vim.json.decode(vim.base64.decode(_A)))", "${payload}")`;
  return ["nvim", "--server", server, "--remote-expr", expression];
}
