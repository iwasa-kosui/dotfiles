// 静的なシェル入力を argv に分ける。入力は実行・展開しない。
// 任意のプログラム、alias、変数から組み立てるコマンドの動作までは解析しない。
export type ShellCommand = { argv: string[]; stdin: string[] };
type Word = { value: string; quoted: boolean };
type HereDoc = Word & { stripTabs: boolean; command: ShellCommand };

class ShellReader {
  private offset = 0;
  readonly commands: ShellCommand[] = [];

  constructor(private readonly source: string) {}

  private arithmetic(): void {
    let depth = 2;
    while (this.offset < this.source.length && depth) {
      if (this.substitution() !== undefined) continue;
      const char = this.source[this.offset++];
      if (char === "(") depth++;
      if (char === ")") depth--;
    }
  }

  private substitution(): string | undefined {
    if (this.source.startsWith("$((", this.offset)) {
      this.offset += 3;
      this.arithmetic();
      return "${dynamic}";
    }
    if (this.source.startsWith("$(", this.offset)) {
      this.offset += 2;
      this.read(true);
      return "${dynamic}";
    }
    if (this.source[this.offset] === "`") {
      this.offset++;
      let script = "";
      while (this.offset < this.source.length && this.source[this.offset] !== "`") {
        if (this.source[this.offset] === "\\") this.offset++;
        script += this.source[this.offset++] ?? "";
      }
      this.offset++;
      this.commands.push(...parseShellCommands(script));
      return "${dynamic}";
    }
    return undefined;
  }

  private word(): Word {
    let value = "";
    let quoted = false;
    let quote = "";
    while (this.offset < this.source.length) {
      const char = this.source[this.offset];
      if (!quote && /[\s;&|()<>]/.test(char)) break;
      if (char === "\\" && quote !== "'") {
        const next = this.source[this.offset + 1];
        if (!quote || next === "\n" || /[$`"\\]/.test(next ?? "")) {
          quoted = true;
          this.offset += 2;
          if (next !== "\n") value += next ?? "";
          continue;
        }
      }
      if (char === quote) {
        quote = "";
        this.offset++;
        continue;
      }
      if (!quote && (char === "'" || char === '"')) {
        quote = char;
        quoted = true;
        this.offset++;
        continue;
      }
      if (quote !== "'") {
        const substitution = this.substitution();
        if (substitution !== undefined) {
          value += substitution;
          continue;
        }
      }
      value += char;
      this.offset++;
    }
    return { value, quoted };
  }

  // 非引用 heredoc 内では、本文の単語ではなく展開されるコマンドだけを拾う。
  expansions(): ShellCommand[] {
    while (this.offset < this.source.length) {
      if (this.source[this.offset] === "\\") {
        this.offset += 2;
      } else if (this.substitution() === undefined) {
        this.offset++;
      }
    }
    return this.commands;
  }

  read(nested = false): ShellCommand[] {
    let command: ShellCommand = { argv: [], stdin: [] };
    const heredocs: HereDoc[] = [];
    const cases: ("subject" | "pattern" | "body")[] = [];
    const flush = () => {
      if (command.argv.length) this.commands.push(command);
      command = { argv: [], stdin: [] };
    };

    while (this.offset < this.source.length) {
      const char = this.source[this.offset];
      if (char === "\\" && this.source[this.offset + 1] === "\n") {
        this.offset += 2;
        continue;
      }
      if (char === "#") {
        while (this.offset < this.source.length && this.source[this.offset] !== "\n") this.offset++;
        continue;
      }
      if (char === "\n") {
        flush();
        this.offset++;
        for (const doc of heredocs.splice(0)) {
          let body = "";
          while (this.offset < this.source.length) {
            const end = this.source.indexOf("\n", this.offset);
            const line = this.source.slice(this.offset, end < 0 ? undefined : end);
            this.offset = end < 0 ? this.source.length : end + 1;
            const stripped = doc.stripTabs ? line.replace(/^\t+/, "") : line;
            if (stripped === doc.value) break;
            body += stripped + "\n";
          }
          doc.command.stdin.push(body);
          if (!doc.quoted) this.commands.push(...new ShellReader(body).expansions());
        }
        continue;
      }
      if (/\s/.test(char)) {
        this.offset++;
        continue;
      }
      // case の選択肢はコマンドではない。各 arm の本文だけを検査する。
      if (cases.at(-1) === "pattern") {
        if (char === ")") cases[cases.length - 1] = "body";
        if (/[()|]/.test(char)) {
          this.offset++;
        } else {
          const pattern = this.word();
          if (!pattern.quoted && pattern.value === "esac") cases.pop();
          if (!pattern.value) this.offset++;
        }
        continue;
      }
      if (char === ")") {
        flush();
        this.offset++;
        if (nested) return this.commands;
        continue;
      }
      if (char === "(") {
        if (this.source.startsWith("((", this.offset)) {
          flush();
          this.offset += 2;
          this.arithmetic();
          continue;
        }
        // 関数の宣言名は実行しない。本文のコマンドは通常どおり検査する。
        if (command.argv.length === 1 && /^\(\s*\)/.test(this.source.slice(this.offset))) command.argv = [];
        flush();
        this.offset++;
        this.read(true);
        continue;
      }
      if (/[;&|]/.test(char)) {
        flush();
        const armEnd = this.source.slice(this.offset).match(/^(?:;;&|;;|;&)/);
        if (cases.at(-1) === "body" && armEnd) {
          cases[cases.length - 1] = "pattern";
          this.offset += armEnd[0].length;
          continue;
        }
        this.offset++;
        continue;
      }
      // リダイレクト先や fd はコマンド名・引数に含めない。
      const redirect = this.source.slice(this.offset).match(/^\d*(<<<|<<-|<<|>>|<>|>&|<&|>\||>|<)/);
      if (redirect) {
        this.offset += redirect[0].length;
        while (/[ \t]/.test(this.source[this.offset] ?? "")) this.offset++;
        if (this.source[this.offset] === "(") {
          this.offset++;
          this.read(true);
          continue;
        }
        const target = this.word();
        if (redirect[1] === "<<" || redirect[1] === "<<-") {
          heredocs.push({ ...target, stripTabs: redirect[1] === "<<-", command });
        } else if (redirect[1] === "<<<") {
          command.stdin.push(target.value);
        }
        continue;
      }
      const token = this.word();
      if (!token.quoted && cases.at(-1) === "subject" && token.value === "in") {
        cases[cases.length - 1] = "pattern";
        continue;
      }
      if (cases.at(-1) === "subject") continue;
      if (!token.quoted && !command.argv.length && token.value === "case") {
        cases.push("subject");
        continue;
      }
      if (!token.quoted && !command.argv.length && token.value === "esac") {
        cases.pop();
        continue;
      }
      if (!token.quoted && !command.argv.length && /^(?:if|then|elif|else|while|until|do|!|\{|\})$/.test(token.value)) continue;
      command.argv.push(token.value);
    }
    flush();
    return this.commands;
  }
}

export function parseShellCommands(source: string): ShellCommand[] {
  return new ShellReader(source).read();
}

// 実行対象を指定する wrapper と、コマンドの前の環境変数代入を取り除く。
export function executableArgv(input: string[]): string[] {
  let argv = input;
  while (argv.length) {
    if (/^[A-Za-z_][A-Za-z_0-9]*=/.test(argv[0])) {
      argv = argv.slice(1);
      continue;
    }
    const name = argv[0].split("/").pop();
    if (!["env", "command", "exec", "builtin", "nohup"].includes(name ?? "")) break;
    let index = 1;
    while (argv[index]?.startsWith("-")) {
      const option = argv[index++];
      if (option === "--") break;
      if (name === "command" && /^-[pvV]*[vV]/.test(option)) return [];
      if ((name === "env" && ["-u", "--unset", "-C", "--chdir"].includes(option)) || (name === "exec" && option === "-a")) index++;
    }
    argv = argv.slice(index);
  }
  return argv;
}
