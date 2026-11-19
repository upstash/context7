import { describe, expect, test } from "vitest";
import { upgradeGuideAnswer } from "../src/lib/api.js";

describe("upgradeGuideAnswer", () => {
  test("keeps not_found for a library without a guide and an unknown version", () => {
    for (const error of ["library_not_prepared", "version_not_found"]) {
      expect(upgradeGuideAnswer({ error, message: "m" })).toEqual({
        text: "m",
        outcome: "not_found",
      });
    }
  });

  test("records a page past the last as invalid", () => {
    expect(upgradeGuideAnswer({ error: "page_out_of_range", message: "m" })).toEqual({
      text: "m",
      outcome: "invalid",
    });
  });

  test("records a guide that cannot be prepared as unavailable with the API's message", () => {
    expect(upgradeGuideAnswer({ error: "guide_unavailable", message: "m" })).toEqual({
      text: "m",
      outcome: "unavailable",
    });
  });

  test("leaves any other error to the caller", () => {
    expect(upgradeGuideAnswer({ error: "invalid_version", message: "m" })).toBeUndefined();
    expect(upgradeGuideAnswer({ error: "toString", message: "m" })).toBeUndefined();
    expect(upgradeGuideAnswer(undefined)).toBeUndefined();
  });
});
