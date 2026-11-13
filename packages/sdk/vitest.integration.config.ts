import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";
import { sharedConfig } from "./vitest.config";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
});
