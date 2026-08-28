// SSRF判定のロジックは dot_claude/hooks/executable_webfetch-guard.ts と同一内容を保つこと。
// デプロイ先が分かれるため import では共有できず、判定条件をここに複製している。

export type GuardResult = { kind: "allowed" } | { kind: "blocked"; reason: string };

export function checkHost(host: string): GuardResult {
  const localhost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  if (localhost.includes(host)) {
    return { kind: "blocked", reason: `ローカルホストへのアクセスはブロックされています: ${host}` };
  }

  const privatePatterns = [
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
  ];
  if (privatePatterns.some((p) => p.test(host))) {
    return { kind: "blocked", reason: `プライベートネットワークへのアクセスはブロックされています: ${host}` };
  }

  if (/\.(internal|local|corp)$/.test(host)) {
    return { kind: "blocked", reason: `内部ドメインへのアクセスはブロックされています: ${host}` };
  }

  return { kind: "allowed" };
}
