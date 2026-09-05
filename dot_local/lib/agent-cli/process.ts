export class CliError extends Error {
  constructor(message: string, readonly exitCode = 2) { super(message); }
}

export function command(args: string[], cwd = process.cwd()) {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString().trimEnd(), err: result.stderr.toString().trimEnd() };
}

export function checked(args: string[], cwd = process.cwd()): string {
  const result = command(args, cwd);
  if (result.code !== 0) throw new CliError(result.err || `${args[0]} failed (${result.code})`, 1);
  return result.out;
}

export async function nonemptyFile(path: string | undefined, flag: string): Promise<string> {
  if (!path) throw new CliError(`${flag} is required`);
  const file = Bun.file(path);
  if (!(await file.exists())) throw new CliError(`${flag}: file not found: ${path}`);
  const text = await file.text();
  if (!text.trim()) throw new CliError(`${flag}: file is empty`);
  return text;
}

export function fail(error: unknown): number {
  console.error(error instanceof Error ? error.message : String(error));
  return error instanceof CliError ? error.exitCode : 1;
}
