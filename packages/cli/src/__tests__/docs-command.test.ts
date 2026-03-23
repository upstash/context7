import { describe, expect, test } from "vitest";

import { normalizeLibraryId } from "../commands/docs.js";

describe("normalizeLibraryId", () => {
  test("preserves already valid library IDs", () => {
    expect(normalizeLibraryId("/facebook/react")).toBe("/facebook/react");
    expect(normalizeLibraryId("/facebook/react/v19.0.0")).toBe("/facebook/react/v19.0.0");
  });

  test("normalizes Git Bash rewritten Windows paths into library IDs", () => {
    expect(normalizeLibraryId("C:/Program Files/Git/facebook/react")).toBe("/facebook/react");
    expect(normalizeLibraryId("C:/Program Files/Git/vercel/next.js/v15.0.0")).toBe(
      "/vercel/next.js/v15.0.0"
    );
  });

  test("leaves unrelated filesystem paths unchanged", () => {
    expect(normalizeLibraryId("C:/Users/alice/project/docs")).toBe("C:/Users/alice/project/docs");
  });
});
