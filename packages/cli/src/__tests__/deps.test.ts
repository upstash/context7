import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";

import { detectProjectDependencies } from "../utils/deps.js";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}

describe("detectProjectDependencies", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ctx7-deps-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("reads root JavaScript and Python dependency files", async () => {
    await writeJson(join(tempDir, "package.json"), {
      dependencies: {
        react: "^19.0.0",
        "@types/node": "^22.0.0",
      },
      devDependencies: {
        vitest: "^4.0.0",
      },
    });
    await writeFile(
      join(tempDir, "requirements.txt"),
      "fastapi==0.115.0\n# ignored\n-r other.txt\nrequests>=2\n",
      "utf-8"
    );
    await writeFile(
      join(tempDir, "pyproject.toml"),
      '[project]\ndependencies = ["pydantic>=2", "fastapi>=0.115"]\n',
      "utf-8"
    );

    await expect(detectProjectDependencies(tempDir)).resolves.toEqual([
      "react",
      "vitest",
      "fastapi",
      "requests",
      "pydantic",
    ]);
  });

  test("aggregates dependencies from pnpm workspace packages", async () => {
    await writeJson(join(tempDir, "package.json"), {
      private: true,
      devDependencies: {
        turbo: "^2.0.0",
        typescript: "^5.7.0",
      },
    });
    await writeFile(
      join(tempDir, "pnpm-workspace.yaml"),
      [
        "packages:",
        '  - "packages/*"',
        "  - apps/* # app packages",
        "",
        "catalog:",
        '  react: "^19.0.0"',
      ].join("\n"),
      "utf-8"
    );

    await writeJson(join(tempDir, "packages", "api", "package.json"), {
      dependencies: {
        zod: "catalog:",
        "@orpc/server": "^1.0.0",
        "drizzle-orm": "^0.38.0",
      },
    });
    await writeJson(join(tempDir, "packages", "db", "package.json"), {
      dependencies: {
        "drizzle-orm": "^0.38.0",
      },
      devDependencies: {
        "drizzle-kit": "^0.30.0",
      },
    });
    await writeJson(join(tempDir, "apps", "web", "package.json"), {
      dependencies: {
        react: "catalog:",
        "@tanstack/react-query": "^5.0.0",
      },
    });

    await expect(detectProjectDependencies(tempDir)).resolves.toEqual([
      "turbo",
      "typescript",
      "zod",
      "@orpc/server",
      "drizzle-orm",
      "drizzle-kit",
      "react",
      "@tanstack/react-query",
    ]);
  });

  test("supports package.json workspace arrays and excludes negated patterns", async () => {
    await writeJson(join(tempDir, "package.json"), {
      workspaces: ["packages/*", "!packages/ignored"],
      dependencies: {
        next: "^15.0.0",
      },
    });
    await writeJson(join(tempDir, "packages", "kept", "package.json"), {
      dependencies: {
        prisma: "^6.0.0",
      },
    });
    await writeJson(join(tempDir, "packages", "ignored", "package.json"), {
      dependencies: {
        shouldNotAppear: "^1.0.0",
      },
    });
    await writeJson(join(tempDir, "packages", "kept", "nested", "package.json"), {
      dependencies: {
        alsoIgnored: "^1.0.0",
      },
    });

    await expect(detectProjectDependencies(tempDir)).resolves.toEqual(["next", "prisma"]);
  });

  test("supports package.json workspaces object syntax", async () => {
    await writeJson(join(tempDir, "package.json"), {
      workspaces: {
        packages: ["tools/*"],
      },
    });
    await writeJson(join(tempDir, "tools", "cli", "package.json"), {
      dependencies: {
        commander: "^13.0.0",
      },
    });

    await expect(detectProjectDependencies(tempDir)).resolves.toEqual(["commander"]);
  });
});
