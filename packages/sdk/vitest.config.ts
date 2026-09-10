import { defineConfig } from "vitest/config";
import path from "path";

export const sharedConfig = {
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@commands": path.resolve(__dirname, "./src/commands"),
      "@http": path.resolve(__dirname, "./src/http"),
      "@error": path.resolve(__dirname, "./src/error/index.ts"),
      "@utils": path.resolve(__dirname, "./src/utils"),
    },
  },
};

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
