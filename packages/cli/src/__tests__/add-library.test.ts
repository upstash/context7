import { describe, expect, test } from "vitest";

import { detectKind, parseAddKind, resolveAddTarget } from "../utils/add-library.js";

describe("detectKind", () => {
  test("detects GitHub", () => {
    expect(detectKind(new URL("https://github.com/vercel/next.js"))).toBe("github");
  });

  test("detects GitLab", () => {
    expect(detectKind(new URL("https://gitlab.com/owner/repo"))).toBe("gitlab");
  });

  test("detects Bitbucket", () => {
    expect(detectKind(new URL("https://bitbucket.org/owner/repo"))).toBe("bitbucket");
  });

  test("detects llms.txt", () => {
    expect(detectKind(new URL("https://docs.example.com/llms.txt"))).toBe("llmstxt");
  });

  test("detects openapi specs", () => {
    expect(detectKind(new URL("https://api.example.com/openapi.json"))).toBe("openapi");
  });

  test("falls back to website for forge-like paths without .git", () => {
    expect(detectKind(new URL("https://codeberg.org/owner/repo"))).toBe("website");
  });

  test("detects explicit .git remotes as git", () => {
    expect(detectKind(new URL("https://codeberg.org/owner/repo.git"))).toBe("git");
  });

  test("falls back to website for shallow URLs", () => {
    expect(detectKind(new URL("https://docs.example.com/"))).toBe("website");
  });

  test("does not treat multi-segment docs URLs as git", () => {
    expect(detectKind(new URL("https://docs.example.com/guide/intro"))).toBe("website");
  });
});

describe("resolveAddTarget", () => {
  test("builds a GitHub add payload", () => {
    const target = resolveAddTarget("https://github.com/vercel/next.js", undefined, {
      private: true,
      gitToken: "tok",
    });
    expect(target).toEqual({
      kind: "github",
      endpointPath: "/api/v2/add/repo/github",
      body: {
        docsRepoUrl: "https://github.com/vercel/next.js",
        private: true,
        gitToken: "tok",
      },
    });
  });

  test("honors explicit website type", () => {
    const target = resolveAddTarget("https://github.com/vercel/next.js", "website");
    expect(target.kind).toBe("website");
    expect(target.endpointPath).toBe("/api/v2/add/website");
    expect(target.body).toEqual({ websiteUrl: "https://github.com/vercel/next.js" });
  });

  test("builds openapi payload", () => {
    const target = resolveAddTarget("https://api.example.com/openapi.yaml", "openapi");
    expect(target).toEqual({
      kind: "openapi",
      endpointPath: "/api/v2/add/openapi",
      body: { openApiUrl: "https://api.example.com/openapi.yaml" },
    });
  });

  test("builds llmstxt payload", () => {
    const target = resolveAddTarget("https://docs.example.com/llms.txt", undefined);
    expect(target).toEqual({
      kind: "llmstxt",
      endpointPath: "/api/v2/add/llmstxt",
      body: { llmstxtUrl: "https://docs.example.com/llms.txt" },
    });
  });

  test("rejects invalid URLs", () => {
    expect(() => resolveAddTarget("not-a-url", undefined)).toThrow(/Invalid URL/);
  });
});

describe("parseAddKind", () => {
  test("parses valid kinds", () => {
    expect(parseAddKind("GitHub")).toBe("github");
    expect(parseAddKind(undefined)).toBeUndefined();
  });

  test("rejects unknown kinds", () => {
    expect(() => parseAddKind("notion")).toThrow(/Invalid --type/);
  });
});
