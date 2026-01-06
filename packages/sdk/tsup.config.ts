import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/client.ts"],
  format: ["cjs", "esm"],
  clean: true,
  dts: true,
});
