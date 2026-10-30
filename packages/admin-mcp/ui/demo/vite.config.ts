import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  build: { outDir: resolve(root, "dist"), emptyOutDir: true, target: "es2022" },
  preview: { port: 4174 },
  plugins: [
    {
      name: "copy-console",
      writeBundle() {
        copyFileSync(resolve(root, "../dist/console.html"), resolve(root, "dist/console.html"));
      },
    },
  ],
});
