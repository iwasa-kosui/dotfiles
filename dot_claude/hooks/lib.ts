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

export async function getWorktreeName(cwd: string): Promise<string | null> {
  const [gitDir, commonDir] = await Promise.all([
    runSafe(["git", "-C", cwd, "--no-optional-locks", "rev-parse", "--git-dir"]),
    runSafe(["git", "-C", cwd, "--no-optional-locks", "rev-parse", "--git-common-dir"]),
  ]);
  if (!gitDir || !commonDir || gitDir === commonDir) return null;
  const toplevel = await runSafe([
    "git", "-C", cwd, "--no-optional-locks", "rev-parse", "--show-toplevel",
  ]);
  if (!toplevel) return null;
  const mainRoot = commonDir.replace(/\/\.git\/?$/, "");
  if (toplevel.startsWith(mainRoot + "/")) {
    const rel = toplevel.slice(mainRoot.length + 1);
    return rel.startsWith(".wt/") ? rel.slice(4) : rel;
  }
  return toplevel.split("/").pop() ?? null;
}
