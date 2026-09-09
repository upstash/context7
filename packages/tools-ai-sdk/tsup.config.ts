import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    agent: "./src/agents/index.ts",
  },
  format: ["cjs", "esm"],
  clean: true,
  // tsup forces `baseUrl: compilerOptions.baseUrl || "."` into its dts worker,
  // which TS 6 reports as TS5101. Scoping the suppression here keeps the
  // regular typecheck honest. Drop once tsup stops injecting it.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  esbuildOptions(options) {
    options.alias = {
      "@tools": "./src/tools/index.ts",
      "@agents": "./src/agents/index.ts",
      "@prompts": "./src/prompts/index.ts",
    };
  },
});
