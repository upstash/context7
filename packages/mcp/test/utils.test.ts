import { describe, expect, test } from "vitest";
import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server";
import { envelopeClientInfo, hasSourceCode } from "../src/lib/utils.js";

// The request _meta envelope is untyped as of SDK 2.0.0, so
// envelopeClientInfo's probing of it is not compile-checked. These tests pin
// the expected shape so an SDK bump that changes it fails loudly.
describe("envelopeClientInfo", () => {
  test("extracts ide/version from a client-info envelope entry", () => {
    const envelope = {
      [CLIENT_INFO_META_KEY]: { name: "cursor", version: "2.2.44" },
    };
    expect(envelopeClientInfo(envelope)).toEqual({ ide: "cursor", version: "2.2.44" });
  });

  test("returns undefined when the envelope is missing or lacks client info", () => {
    expect(envelopeClientInfo(undefined)).toBeUndefined();
    expect(envelopeClientInfo({})).toBeUndefined();
  });
});

describe("hasSourceCode", () => {
  test("marks Git repository libraries, not websites or llms.txt", () => {
    expect(hasSourceCode({ id: "/colinhacks/zod", branch: "main" })).toBe(true);
    expect(hasSourceCode({ id: "/websites/zod_dev", branch: "_contextdev_" })).toBe(false);
    expect(hasSourceCode({ id: "/llmstxt/zod_dev_llms_txt", branch: "_llmstxt_" })).toBe(false);
  });
});
