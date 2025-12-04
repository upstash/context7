import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier";

export default defineConfig(
  {
    // Base ESLint configuration
    ignores: ["node_modules/**", "build/**", "dist/**", ".git/**", ".github/**"],
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
  }
);
