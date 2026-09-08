import { describe, expect, test } from "vitest";

import { recoverLibraryId } from "../utils/library-id.js";

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

  test("recovers from a versioned Scoop Git install", () => {
    expect(recoverLibraryId("D:/Scoop/apps/git/2.54.0/vercel/next.js")).toBe("/vercel/next.js");
    expect(recoverLibraryId("D:\\Scoop\\apps\\git\\2.54.0.windows.1\\vercel\\next.js")).toBe(
      "/vercel/next.js"
    );
  });

  test("recovers from an unresolved Scoop current junction", () => {
    expect(recoverLibraryId("D:/Scoop/apps/git/current/vercel/next.js")).toBe("/vercel/next.js");
  });

  test("does not treat a version-like owner in a standard Git install as a Scoop version", () => {
    expect(recoverLibraryId("C:/Program Files/Git/2.54.0/vercel")).toBe("/2.54.0/vercel");
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
