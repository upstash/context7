import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

config();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@tools": path.resolve(__dirname, "./src/tools/index.ts"),
      "@agents": path.resolve(__dirname, "./src/agents/index.ts"),
      "@prompts": path.resolve(__dirname, "./src/prompts/index.ts"),
    },
  },
});
