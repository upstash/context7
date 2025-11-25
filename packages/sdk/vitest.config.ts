import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: process.env,
  },
  resolve: {
    alias: {
      "@commands": path.resolve(__dirname, "./src/commands"),
      "@http": path.resolve(__dirname, "./src/http"),
      "@error": path.resolve(__dirname, "./src/error/index.ts"),
    },
  },
});
