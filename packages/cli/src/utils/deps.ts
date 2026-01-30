import { readFile } from "fs/promises";
import { join } from "path";

export interface DetectedDependency {
  name: string;
  source: string;
  ecosystem: string;
}

const SKIP_SET = new Set([
  "typescript",
  "python",
  "setuptools",
  "pip",
  "wheel",
  "node",
  "npm",
  "yarn",
  "pnpm",
  "eslint",
  "prettier",
  "jest",
  "mocha",
  "vitest",
  "webpack",
  "vite",
  "esbuild",
  "tsup",
  "turbo",
]);

// Well-known frameworks and libraries that are likely to have relevant skills
const NOTABLE_SET = new Set([
  // Node / JS / TS
  "react",
  "next",
  "vue",
  "nuxt",
  "svelte",
  "angular",
  "express",
  "fastify",
  "nestjs",
  "@nestjs/core",
  "hono",
  "remix",
  "astro",
  "gatsby",
  "tailwindcss",
  "prisma",
  "@prisma/client",
  "drizzle-orm",
  "typeorm",
  "sequelize",
  "mongoose",
  "graphql",
  "@trpc/server",
  "zod",
  "socket.io",
  "three",
  "d3",
  "electron",
  "redis",
  "ioredis",
  "bullmq",
  "stripe",
  "@supabase/supabase-js",
  "firebase",
  "@auth/core",
  "next-auth",
  "lucia",
  "better-auth",
  "convex",
  "@tanstack/react-query",
  "zustand",
  "jotai",
  "mobx",
  "redux",
  "@reduxjs/toolkit",
  "playwright",
  "cypress",
  "storybook",
  "docker",
  "kubernetes",
  // Python
  "django",
  "flask",
  "fastapi",
  "pytorch",
  "torch",
  "tensorflow",
  "numpy",
  "pandas",
  "scikit-learn",
  "langchain",
  "celery",
  "sqlalchemy",
  "pydantic",
  "streamlit",
  "scrapy",
  "boto3",
  "transformers",
  "openai",
  "anthropic",
]);

const MAX_QUERIES = 15;

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function isSkipped(name: string): boolean {
  if (SKIP_SET.has(name)) return true;
  if (name.startsWith("@types/")) return true;
  return false;
}

function isNotable(name: string): boolean {
  return NOTABLE_SET.has(name.toLowerCase());
}

async function parsePackageJson(cwd: string): Promise<DetectedDependency[]> {
  const content = await readFileOrNull(join(cwd, "package.json"));
  if (!content) return [];

  try {
    const pkg = JSON.parse(content);
    const names = new Set<string>();

    for (const key of Object.keys(pkg.dependencies || {})) {
      if (!isSkipped(key) && isNotable(key)) names.add(key);
    }
    for (const key of Object.keys(pkg.devDependencies || {})) {
      if (!isSkipped(key) && isNotable(key)) names.add(key);
    }

    return [...names].map((name) => ({
      name,
      source: "package.json",
      ecosystem: "node",
    }));
  } catch {
    return [];
  }
}

async function parseRequirementsTxt(cwd: string): Promise<DetectedDependency[]> {
  const content = await readFileOrNull(join(cwd, "requirements.txt"));
  if (!content) return [];

  const deps: DetectedDependency[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const name = trimmed.split(/[=<>!~;@\s\[]/)[0].trim();
    if (name && !isSkipped(name) && isNotable(name)) {
      deps.push({ name, source: "requirements.txt", ecosystem: "python" });
    }
  }
  return deps;
}

async function parsePyprojectToml(cwd: string): Promise<DetectedDependency[]> {
  const content = await readFileOrNull(join(cwd, "pyproject.toml"));
  if (!content) return [];

  const deps: DetectedDependency[] = [];
  const seen = new Set<string>();

  // Match dependencies in [project.dependencies] array
  const projectDepsMatch = content.match(/\[project\]\s[\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (projectDepsMatch) {
    const entries = projectDepsMatch[1].match(/"([^"]+)"/g) || [];
    for (const entry of entries) {
      const name = entry
        .replace(/"/g, "")
        .split(/[=<>!~;@\s\[]/)[0]
        .trim();
      if (name && !isSkipped(name) && isNotable(name) && !seen.has(name)) {
        seen.add(name);
        deps.push({ name, source: "pyproject.toml", ecosystem: "python" });
      }
    }
  }

  // Match [tool.poetry.dependencies] section
  const poetryMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (poetryMatch) {
    const lines = poetryMatch[1].split("\n");
    for (const line of lines) {
      const match = line.match(/^(\S+)\s*=/);
      if (match) {
        const name = match[1].trim();
        if (name && !isSkipped(name) && isNotable(name) && name !== "python" && !seen.has(name)) {
          seen.add(name);
          deps.push({ name, source: "pyproject.toml", ecosystem: "python" });
        }
      }
    }
  }

  return deps;
}

export async function detectProjectDependencies(cwd: string): Promise<DetectedDependency[]> {
  const results = await Promise.all([
    parsePackageJson(cwd),
    parseRequirementsTxt(cwd),
    parsePyprojectToml(cwd),
  ]);

  return results.flat();
}

export function buildSearchQueries(deps: DetectedDependency[]): { query: string; dep: string }[] {
  const queries: { query: string; dep: string }[] = [];
  const seen = new Set<string>();

  for (const dep of deps) {
    if (queries.length >= MAX_QUERIES) break;
    const lower = dep.name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    queries.push({ query: dep.name, dep: dep.name });
  }

  return queries;
}
