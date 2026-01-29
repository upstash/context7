import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  noExternal: [],
  external: [
    "@inquirer/core",
    "@inquirer/type",
    "@inquirer/prompts",
    "mute-stream",
    "stream",
  ],
});
