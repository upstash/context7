import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

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
      "@utils": path.resolve(__dirname, "./src/utils"),
    },
  },
});
