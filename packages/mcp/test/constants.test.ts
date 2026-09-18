import { describe, expect, test } from "vitest";
import {
  RESOURCE_URL,
  canonicalMcpResourceUrl,
  mcpServerCard,
  protectedResourceMetadataDocument,
  protectedResourceMetadataPath,
} from "../src/lib/constants.js";

describe("MCP resource identifiers", () => {
  test("appends /mcp to origin-only RESOURCE_URL values", () => {
    expect(RESOURCE_URL).toBe("https://mcp.context7.com");
    expect(canonicalMcpResourceUrl()).toBe(`${RESOURCE_URL}/mcp`);
    expect(protectedResourceMetadataPath()).toBe("/.well-known/oauth-protected-resource/mcp");
  });

  test("keeps an explicit resource path", () => {
    expect(canonicalMcpResourceUrl("https://mcp.example.com/mcp")).toBe(
      "https://mcp.example.com/mcp"
    );
    expect(protectedResourceMetadataPath("https://mcp.example.com/mcp")).toBe(
      "/.well-known/oauth-protected-resource/mcp"
    );
  });

  test("advertises the canonical /mcp resource in PRM and the server card", () => {
    expect(protectedResourceMetadataDocument()).toMatchObject({
      resource: canonicalMcpResourceUrl(),
      authorization_servers: ["https://clerk.context7.com", "https://context7.com"],
      bearer_methods_supported: ["header"],
    });
    expect(mcpServerCard()).toMatchObject({
      name: "io.github.upstash/context7",
      remotes: [{ type: "streamable-http", url: canonicalMcpResourceUrl() }],
    });
  });
});
