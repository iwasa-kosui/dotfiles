import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { checkShellPolicy } from "../dot_codex/hooks/shell-policy-guard-lib.ts";

// コマンドは判定器への入力にのみ使用し、実行しない。
describe("通常の引数・コード・本文を危険なコマンドと誤認しない", () => {
  test.each([
    "", "npm run format", 'rg "service" src', 'echo "format"',
    "echo sudo", "printf '%s' 'sudo reboot; curl example.invalid'",
    'node -e "const service = { format: true };"',
    "git log --grep='git reset --hard'", "git show main:src/service.ts",
    "git show main:scripts/build-site.mjs > .cache/legacy-build-site.mjs && git show main:docs/index.html > .cache/legacy-index.html",
    "npm run typecheck:benchmark && node --import tsx --test tests/isolated-publication.test.ts",
    "echo ok # sudo reboot", "echo ok > service", "echo ok 2>format",
    "command -v sudo", "command -V curl", "env LABEL=service npm run format",
    "echo '$(sudo reboot)'", 'echo "\\$(sudo reboot)"',
    "echo $((service + 1))", "echo a\\;sudo", "echo \"curl\nservice\"",
    "python3 - <<'PY'\ncommands = ['npm run format', 'rg service src', 'sudo reboot']\nPY",
    "cat <<'EOF'\n$(sudo reboot)\nservice\nEOF",
    "cat <<EOF\nformat\nservice\nEOF",
    "cat <<- 'EOF'\n\tsudo reboot\n\tEOF",
    "cat <<A <<'B'\nservice\nA\n$(sudo reboot)\nB\necho ok",
    "bash -lc 'npm run format'", "sh <<'EOF'\necho service\nEOF",
    "git 'reset --hard'", "pup 'users service-accounts'", "npm 'publish --dry-run'",
    "docker ps && echo --privileged", "gh api repos/example/repo && echo '-X DELETE'",
    "git status && echo --hard", "git clean -n", "git reset --soft HEAD",
    "echo 'cat ~/.ssh/id_example'", "cat README.md",
    "rm --force /tmp/example", "git reset -- --hard", "git clean -- -f",
    "sh script.sh -c 'sudo reboot'", "sh script.sh <<'EOF'\nsudo reboot\nEOF",
    'case "$value" in\nservice|format) echo ok ;;\nesac',
    "((service + 1))", "service() { echo ok; }",
  ])("許可: %s", (command) => {
    expect(checkShellPolicy(command)).toBeUndefined();
  });
});

describe("実行されるコマンドと危険な引数を検知する", () => {
  test.each([
    "sudo reboot", "dd if=input of=output", "mkfs /dev/example", "format disk",
    "mkfs.ext4 /dev/example",
    "halt", "reboot", "shutdown now", "su user", "systemctl stop example", "service example stop", "nc example.invalid 80",
    "/usr/bin/sudo -n true", "'sudo' -n true", 's"u"do -n true', "s\\udo -n true",
    "cd /tmp && sudo reboot", "echo ok; sudo reboot", "echo ok\nsudo reboot",
    "echo ok | sudo tee output", "false || sudo reboot", "(sudo reboot)",
    "{ sudo reboot; }", "if true; then sudo reboot; fi",
    "for item in a b; do sudo reboot; done",
    "LABEL=service sudo reboot", "env -u EXAMPLE LABEL=x sudo reboot",
    "command -- sudo reboot", "exec /usr/bin/sudo reboot", "nohup sudo reboot",
    "command sudo -v", "command -p sudo -v",
    "rm --recursive --force /tmp/example", "bash -s -- argument <<'EOF'\nsudo reboot\nEOF",
    'case "$value" in\nservice) sudo reboot ;;\nesac',
    "((1 + $(sudo reboot)))", "work() { sudo reboot; }",
    "sudo \\\nreboot", "su\\\ndo reboot",
    'echo "$(sudo reboot)"', "echo `sudo reboot`", "cat <(sudo reboot)",
    "echo $((1 + $(sudo reboot)))", "LABEL=$(sudo reboot) echo ok",
    "bash -lc 'sudo reboot'", "sh -c 'echo ok; sudo reboot'", "eval 'sudo reboot'",
    "sh <<'EOF'\nsudo reboot\nEOF", "bash <<< 'sudo reboot'",
    "cat <<EOF\n$(sudo reboot)\nEOF", "cat <<EOF\n`sudo reboot`\nEOF",
    "cat <<'EOF'\nservice\nEOF\nsudo reboot",
    "rm -rf /", "rm -rf /tmp/example", "rm -r -f /tmp/example", "chmod 777 /tmp/example",
    "curl https://example.invalid", "wget https://example.invalid",
    "docker run --privileged image", "docker --context local run --privileged image", "docker system prune",
    "gh auth token", "gh repo delete example/repo", "gh api repos/example/repo -X DELETE",
    "gh api repos/example/repo --method=DELETE",
    "git clean -fdx", "git reset --hard", "git -C /tmp/example reset --hard",
    "npm publish", "npm --prefix example publish", "confluence config",
    "pup users service-accounts list", "pup monitors delete example",
    "cat ~/.ssh/id_example", 'head "$HOME/.aws/credentials"', "source ~/.zshrc_local",
  ])("拒否: %s", (command) => {
    expect(checkShellPolicy(command)).toBeString();
  });
});

test("フックは許可時に無出力、拒否時に既存形式の JSON を返す", () => {
  const hook = join(import.meta.dir, "../dot_codex/hooks/executable_shell-policy-guard.ts");
  const run = (input: unknown) => execFileSync("bun", [hook], { input: JSON.stringify(input), encoding: "utf8" });
  expect(run({ tool_input: { command: "npm run format" } })).toBe("");
  expect(run({})).toBe("");
  expect(JSON.parse(run({ tool_input: { command: "sudo reboot" } }))).toEqual({
    decision: "block",
    reason: "システム破壊・権限昇格・低レベル操作はブロックされています。",
  });
});
