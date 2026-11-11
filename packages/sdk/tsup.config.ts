import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/client.ts"],
  format: ["cjs", "esm"],
  clean: true,
  // tsup forces `baseUrl: compilerOptions.baseUrl || "."` into its dts worker,
  // which TS 6 reports as TS5101. Scoping the suppression here keeps the
  // regular typecheck honest. Drop once tsup stops injecting it.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
});
