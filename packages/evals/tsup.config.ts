import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "./src/index.ts" },
  format: ["cjs", "esm"],
  clean: true,
  dts: true,
});
