import mdx from "@astrojs/mdx";
import { defineConfig, passthroughImageService } from "astro/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcore } from "webcoreui/integration";

const templateRoot = fileURLToPath(new URL(".", import.meta.url));
const localNodeModules = join(templateRoot, "node_modules");
const nodeModules = existsSync(localNodeModules)
  ? localNodeModules
  : join(templateRoot, "../node_modules");

export default defineConfig({
  output: "static",
  outDir: "./dist",
  cacheDir: "./.astro-cache",
  integrations: [mdx(), webcore()],
  image: { service: passthroughImageService() },
  build: { format: "file", inlineStylesheets: "always" },
  vite: {
    cacheDir: "./.vite-cache",
    resolve: {
      alias: {
        "@webcoreui": join(nodeModules, "webcoreui"),
      },
    },
  },
});
