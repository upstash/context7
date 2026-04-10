import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getDefaultCACertificates, loadCustomCACerts } from "../src/lib/api.js";

test("loadCustomCACerts returns undefined when no path is provided", () => {
  assert.equal(loadCustomCACerts(undefined), undefined);
});

test("loadCustomCACerts appends custom certs to Node default CAs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "context7-ca-test-"));
  const certPath = join(tempDir, "custom-ca.pem");
  const customCert = [
    "-----BEGIN CERTIFICATE-----",
    "MIIBhTCCASugAwIBAgIUPcY2K4+testonlycertificateblockA9xYwCgYIKoZIzj0E",
    "AwIwGDEWMBQGA1UEAwwNQ29udGV4dDcgVGVzdDAeFw0yNjA0MTAwMDAwMDBaFw0y",
    "NjA0MTEwMDAwMDBaMBgxFjAUBgNVBAMMDUNvbnRleHQ3IFRlc3QwWTATBgcqhkjO",
    "PQIBBggqhkjOPQMBBwNCAASrK8V0k5YJmN5v1J3t2G9u8rY3C2Jw4P3u8K1JdQxWl",
    "m0x1X4Q2aO2m1QvX7p8oI1Y7r9cT5n6s4a8t0pVx4XWPo1MwUTAdBgNVHQ4EFgQU",
    "B1a8wN1Yv3e6m7J4k2a9jX0wCgYIKoZIzj0EAwIDSAAwRQIhALyM2n0XWw8b0e9j",
    "i0X9l3fY8o0s5Q0d3sV9mH0K7v5aAiB5a1T3qK9zR6wP8sV3mT7aN2k4dP6qC8e1",
    "n0uWJ0x4Qg==",
    "-----END CERTIFICATE-----",
  ].join("\n");

  writeFileSync(certPath, `${customCert}\n`, "utf-8");

  try {
    const defaultCAs = getDefaultCACertificates();
    const mergedCAs = loadCustomCACerts(certPath);

    assert.ok(mergedCAs);
    assert.equal(mergedCAs.length, defaultCAs.length + 1);
    assert.deepEqual(mergedCAs.slice(0, defaultCAs.length), defaultCAs);
    assert.equal(mergedCAs.at(-1), `${customCert}\n`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
