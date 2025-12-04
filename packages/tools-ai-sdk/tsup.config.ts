import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    agent: "./src/agents/index.ts",
  },
  format: ["cjs", "esm"],
  clean: true,
  dts: true,
  esbuildOptions(options) {
    options.alias = {
      "@tools": "./src/tools/index.ts",
      "@agents": "./src/agents/index.ts",
      "@prompts": "./src/prompts/index.ts",
    };
  },
});
