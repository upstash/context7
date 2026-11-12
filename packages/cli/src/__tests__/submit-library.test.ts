import { describe, expect, test } from "vitest";

import { detectSubmitKind, parseSubmitKind, resolveSubmitTarget } from "../utils/submit-library.js";

describe("detectSubmitKind", () => {
  test("detects GitHub", () => {
    expect(detectSubmitKind(new URL("https://github.com/vercel/next.js"))).toBe("github");
  });

  test("detects GitLab", () => {
    expect(detectSubmitKind(new URL("https://gitlab.com/owner/repo"))).toBe("gitlab");
  });

  test("detects Bitbucket", () => {
    expect(detectSubmitKind(new URL("https://bitbucket.org/owner/repo"))).toBe("bitbucket");
  });

  test("detects llms.txt", () => {
    expect(detectSubmitKind(new URL("https://docs.example.com/llms.txt"))).toBe("llmstxt");
  });

  test("detects openapi specs", () => {
    expect(detectSubmitKind(new URL("https://api.example.com/openapi.json"))).toBe("openapi");
  });

  test("falls back to website for forge-like paths without .git", () => {
    expect(detectSubmitKind(new URL("https://codeberg.org/owner/repo"))).toBe("website");
  });

  test("detects explicit .git remotes as git", () => {
    expect(detectSubmitKind(new URL("https://codeberg.org/owner/repo.git"))).toBe("git");
  });

  test("falls back to website for shallow URLs", () => {
    expect(detectSubmitKind(new URL("https://docs.example.com/"))).toBe("website");
  });

  test("does not treat multi-segment docs URLs as git", () => {
    expect(detectSubmitKind(new URL("https://docs.example.com/guide/intro"))).toBe("website");
  });
});

describe("resolveSubmitTarget", () => {
  test("builds a GitHub submit payload", () => {
    const target = resolveSubmitTarget("https://github.com/vercel/next.js", undefined, {
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
    const target = resolveSubmitTarget("https://github.com/vercel/next.js", "website");
    expect(target.kind).toBe("website");
    expect(target.endpointPath).toBe("/api/v2/add/website");
    expect(target.body).toEqual({ websiteUrl: "https://github.com/vercel/next.js" });
  });

  test("limits a website crawl to a documentation root", () => {
    const target = resolveSubmitTarget("https://dlang.org/spec/spec.html", "website", {
      websiteBaseUrl: "https://dlang.org/spec/",
    });
    expect(target.body).toEqual({
      websiteUrl: "https://dlang.org/spec/spec.html",
      websiteBaseUrl: "https://dlang.org/spec/",
    });
  });

  test("rejects a crawl root on a Git repository", () => {
    expect(() =>
      resolveSubmitTarget("https://github.com/vercel/next.js", undefined, {
        websiteBaseUrl: "https://github.com/vercel/next.js",
      })
    ).toThrow(/--website-base-url/);
  });

  test("builds openapi payload", () => {
    const target = resolveSubmitTarget("https://api.example.com/openapi.yaml", "openapi");
    expect(target).toEqual({
      kind: "openapi",
      endpointPath: "/api/v2/add/openapi",
      body: { openApiUrl: "https://api.example.com/openapi.yaml" },
    });
  });

  test("builds llmstxt payload", () => {
    const target = resolveSubmitTarget("https://docs.example.com/llms.txt", undefined);
    expect(target).toEqual({
      kind: "llmstxt",
      endpointPath: "/api/v2/add/llmstxt",
      body: { llmstxtUrl: "https://docs.example.com/llms.txt" },
    });
  });

  test("rejects invalid URLs", () => {
    expect(() => resolveSubmitTarget("not-a-url", undefined)).toThrow(/Invalid URL/);
  });
});

describe("parseSubmitKind", () => {
  test("parses valid kinds", () => {
    expect(parseSubmitKind("GitHub")).toBe("github");
    expect(parseSubmitKind(undefined)).toBeUndefined();
  });

  test("rejects unknown kinds", () => {
    expect(() => parseSubmitKind("notion")).toThrow(/Invalid --type/);
  });
});
