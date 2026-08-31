import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  external: [
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-credentials",
    "@deepseek-ai/dsh-system-prompt",
    "@deepseek-ai/dsh-tools",
  ],
});
