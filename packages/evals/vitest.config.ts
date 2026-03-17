import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.eval.ts"],
  },
});
