export type ExitCode = 2 | 3 | 4 | 5;

export type Failure = Readonly<{
  kind: "usage" | "input" | "build" | "io";
  exitCode: ExitCode;
  message: string;
  hint?: string;
  location?: Readonly<{ line: number; column: number }>;
  cause?: unknown;
}>;

export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Failure }>;

export function failure(
  message: string,
  overrides: Omit<Failure, "kind" | "exitCode" | "message"> = {},
): Result<never> {
  return {
    ok: false,
    error: {
      kind: "usage",
      exitCode: 2,
      message,
      ...overrides,
    },
  };
}
