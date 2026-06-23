import { describe, expect, test } from "vitest";

import { normalizeLibraryId, recoverLibraryId } from "../utils/library-id.js";

describe("recoverLibraryId", () => {
  test("passes through a normal library ID unchanged", () => {
    expect(recoverLibraryId("/facebook/react")).toBe("/facebook/react");
    expect(recoverLibraryId("/vercel/next.js/v15.1.8")).toBe("/vercel/next.js/v15.1.8");
  });

  test("recovers a Git Bash mangled path (default install dir)", () => {
    expect(recoverLibraryId("C:/Program Files/Git/facebook/react")).toBe("/facebook/react");
  });

  test("recovers a mangled path with backslashes", () => {
    expect(recoverLibraryId("C:\\Program Files\\Git\\facebook\\react")).toBe("/facebook/react");
  });

  test("preserves a version segment", () => {
    expect(recoverLibraryId("C:/Program Files/Git/vercel/next.js/v15.1.8")).toBe(
      "/vercel/next.js/v15.1.8"
    );
  });

  test("recovers from a portable Git install", () => {
    expect(recoverLibraryId("D:/tools/PortableGit/facebook/react")).toBe("/facebook/react");
  });

  test("recovers an owner that looks like a system dir", () => {
    expect(recoverLibraryId("C:/Program Files/Git/usr/some-repo")).toBe("/usr/some-repo");
  });

  test("collapses the leading double-slash workaround", () => {
    expect(recoverLibraryId("//facebook/react")).toBe("/facebook/react");
  });

  test("leaves a non-Windows-path argument untouched", () => {
    expect(recoverLibraryId("facebook/react")).toBe("facebook/react");
  });

  test("leaves an unrecognized Windows path untouched", () => {
    expect(recoverLibraryId("C:/Users/me/project")).toBe("C:/Users/me/project");
  });
});

describe("normalizeLibraryId", () => {
  test("lowercases case-insensitive library ID segments", () => {
    expect(normalizeLibraryId("/ClickHouse/ClickHouse")).toBe("/clickhouse/clickhouse");
    expect(normalizeLibraryId("/websites/Example_COM")).toBe("/websites/example_com");
  });

  test("preserves version suffix casing", () => {
    expect(normalizeLibraryId("/Vercel/Next.js/v15.1.8-CANARY")).toBe(
      "/vercel/next.js/v15.1.8-CANARY"
    );
  });

  test("leaves invalid IDs untouched", () => {
    expect(normalizeLibraryId("facebook/react")).toBe("facebook/react");
  });
});
