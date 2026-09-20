import { executableArgv, parseShellCommands } from "./shell-command-lib.ts";

const reasons = {
  system: "システム破壊・権限昇格・低レベル操作はブロックされています。",
  network: "curl/wget による直接ネットワーク取得はブロックされています。必要なら、手順書を作成してユーザーに実行させてください。",
  docker: "危険な Docker 操作はブロックされています。",
  github: "GitHub token 表示・リポジトリ削除・DELETE API はブロックされています。",
  git: "破壊的な git 操作はブロックされています。",
  npm: "npm publish はブロックされています。",
  external: "外部サービスの作成・更新・削除系 CLI 操作はブロックされています。",
  secret: "秘密情報ファイルを表示・検索・source する操作はブロックされています。",
};

const lowLevelCommands = new Set(["dd", "mkfs", "format", "halt", "reboot", "shutdown", "sudo", "su", "systemctl", "service", "nc"]);
const externalOperations = [
  "data-deletion", "api-keys", "app-keys", "users service-accounts", "monitors delete",
  "dashboards delete", "slos delete", "obs-pipelines", "cloud", "integrations", "workflows",
  "runbooks run", "fleet", "on-call", "downtime cancel", "investigations trigger",
  "logs-restriction", "security rules", "debugger probes", "tags", "scorecards",
  "static-analysis", "change-requests", "cases", "app-builder", "status-pages",
  "product-analytics events send", "llm-obs", "reference-tables", "datasets",
  "idp register", "hamr connections create", "incidents", "acp serve",
].map((operation) => operation.split(" "));
const startsWith = (args: string[], prefix: string[]) => prefix.every((value, index) => args[index] === value);

function beforeDoubleDash(args: string[]): string[] {
  const end = args.indexOf("--");
  return end < 0 ? args : args.slice(0, end);
}

function subcommandArgs(args: string[], valuedOptions: string[]): string[] {
  let index = 0;
  while (args[index]?.startsWith("-")) {
    const option = args[index++];
    if (option === "--") break;
    if (valuedOptions.includes(option)) index++;
  }
  return args.slice(index);
}

function blockedArgv(argv: string[]): string | undefined {
  const name = argv[0]?.split("/").pop();
  const args = argv.slice(1);
  if (lowLevelCommands.has(name ?? "") || /^mkfs\./.test(name ?? "")) return reasons.system;
  if (name === "rm") {
    const options = beforeDoubleDash(args);
    const recursive = options.some((arg) => /^-[^-]*[rR]/.test(arg) || arg === "--recursive");
    const force = options.some((arg) => /^-[^-]*f/.test(arg) || arg === "--force");
    if (recursive && force && args.some((arg) => arg.startsWith("/"))) return reasons.system;
  }
  if (name === "chmod" && args.includes("777") && args.some((arg) => arg.startsWith("/"))) return reasons.system;
  if (name === "curl" || name === "wget") return reasons.network;
  if (name === "docker") {
    const sub = subcommandArgs(args, ["--context", "-c", "--host", "-H", "--config"]);
    if ((sub[0] === "run" && sub.some((arg) => arg === "--privileged" || arg === "--privileged=true")) || startsWith(sub, ["system", "prune"])) return reasons.docker;
  }
  if (name === "gh") {
    const sub = subcommandArgs(args, ["--repo", "-R", "--hostname"]);
    if (startsWith(sub, ["auth", "token"]) || startsWith(sub, ["repo", "delete"]) || (sub[0] === "api" && sub.some((arg, index) => ((arg === "-X" || arg === "--method") && sub[index + 1] === "DELETE") || arg === "--method=DELETE" || arg === "-XDELETE"))) return reasons.github;
  }
  if (name === "git") {
    const sub = subcommandArgs(args, ["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
    const options = beforeDoubleDash(sub.slice(1));
    if ((sub[0] === "reset" && options.includes("--hard")) || (sub[0] === "clean" && options.some((arg) => /^-[a-z]*f/.test(arg) || arg === "--force"))) return reasons.git;
  }
  if (name === "npm" && subcommandArgs(args, ["--prefix", "--workspace", "-w", "--registry"])[0] === "publish") return reasons.npm;
  if ((name === "confluence" && args[0] === "config") || (name === "pup" && externalOperations.some((prefix) => startsWith(args, prefix)))) return reasons.external;
  if (["cat", "head", "tail", "less", "more", "grep", "sed", "awk", "source", "."].includes(name ?? "") && args.some((arg) => /^(?:~|\$HOME|\$\{HOME\})\/(?:\.zshrc_local|\.aws|\.ssh|\.gnupg|\.npmrc|\.netrc|\.docker\/config\.json|\.kube|\.config\/gh\/hosts\.yml|\.config\/confluence-cli|\.config\/jira-cli|\.env)(?:\/|$)/.test(arg))) return reasons.secret;
  return undefined;
}

function shellSources(args: string[], stdin: string[]): string[] {
  let readsStdin = false;
  let index = 0;
  while (args[index]?.startsWith("-")) {
    const option = args[index++];
    if (option === "--") break;
    if (/^-[^-]*c/.test(option)) return [args[index] ?? ""];
    if (/^-[^-]*s/.test(option)) readsStdin = true;
    if (["-o", "+o", "-O", "+O", "--rcfile", "--init-file"].includes(option)) index++;
  }
  // スクリプトファイルを指定したシェルの stdin は、そのスクリプトへのデータ。
  return readsStdin || index === args.length ? stdin : [];
}

export function checkShellPolicy(command: string): string | undefined {
  for (const parsed of parseShellCommands(command)) {
    const argv = executableArgv(parsed.argv);
    const reason = blockedArgv(argv);
    if (reason) return reason;
    const name = argv[0]?.split("/").pop();
    // シェルに渡すソースだけ再解析する。Python/Node のコードや通常の引数はデータ。
    if (["sh", "bash", "zsh", "dash", "ksh"].includes(name ?? "")) {
      for (const source of shellSources(argv.slice(1), parsed.stdin)) {
        const nested = checkShellPolicy(source);
        if (nested) return nested;
      }
    }
    if (name === "eval") {
      const nested = checkShellPolicy(argv.slice(1).join(" "));
      if (nested) return nested;
    }
  }
  return undefined;
}
