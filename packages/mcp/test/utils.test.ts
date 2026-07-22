import { describe, expect, test } from "vitest";
import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server";
import { envelopeClientInfo } from "../src/lib/utils.js";

// The request _meta envelope is untyped in the current SDK beta, so
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
