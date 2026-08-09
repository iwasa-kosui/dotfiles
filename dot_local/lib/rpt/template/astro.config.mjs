import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { webcore } from "webcoreui/integration";

export default defineConfig({
  output: "static",
  outDir: "./dist",
  cacheDir: "./.astro-cache",
  integrations: [mdx(), webcore()],
  build: { format: "file", inlineStylesheets: "always" },
  vite: { cacheDir: "./.vite-cache" },
});
