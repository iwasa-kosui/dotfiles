import { join } from "node:path";

export function createAstroBuildCommand(
  packageRoot: string,
): readonly ["bun", string, "build"] {
  return ["bun", join(packageRoot, "node_modules/astro/astro.js"), "build"];
}
