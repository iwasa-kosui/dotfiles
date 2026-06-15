export async function readInput<T = Record<string, unknown>>(): Promise<T> {
  const text = await Bun.stdin.text();
  return JSON.parse(text) as T;
}

export async function run(
  cmd: string[],
  opts?: { cwd?: string },
): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr}`);
  }
  return stdout.trimEnd();
}

export async function runSafe(
  cmd: string[],
  opts?: { cwd?: string },
): Promise<string | null> {
  try {
    return await run(cmd, opts);
  } catch {
    return null;
  }
}
