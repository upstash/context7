import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier";

export default defineConfig(
  {
    // Base ESLint configuration
    ignores: ["node_modules/**", "build/**", "dist/**", ".git/**", ".github/**", "tsup.config.ts", "vitest.config.ts"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Add Node.js globals
        process: "readonly",
        require: "readonly",
        module: "writable",
        console: "readonly",
      },
    },
    // Settings for all files
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      prettier: eslintPluginPrettier,
    },
    rules: {
      // TypeScript recommended rules
      ...tseslint.configs.recommended.rules,
      // TypeScript rules
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // Prettier integration
      "prettier/prettier": "error",
    },
  },
  {
    // Commands must not hand-roll the "load tokens, check expiry" dance: it
    // skips the refresh and silently degrades to an anonymous request.
    files: ["src/commands/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../utils/auth.js",
              importNames: ["loadTokens", "isTokenExpired"],
              message: "Use getValidAccessToken() so an expired token refreshes.",
            },
          ],
        },
      ],
    },
  }
);
