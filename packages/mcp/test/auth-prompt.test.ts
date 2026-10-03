import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test, vi } from "vitest";
import { maybeElicitAuthSignIn } from "../src/lib/auth/auth-prompt.js";
import type { ClientContext } from "../src/lib/types.js";

describe("maybeElicitAuthSignIn", () => {
  test("consumes the backend prompt signal after eliciting once", () => {
    const elicitInput = vi.fn().mockResolvedValue(undefined);
    const server = {
      server: {
        getClientCapabilities: () => ({ elicitation: {} }),
        elicitInput,
      },
    } as unknown as McpServer;
    const context: ClientContext = {
      shouldPrompt: true,
      transport: "stdio",
    };

    maybeElicitAuthSignIn(server, context);
    maybeElicitAuthSignIn(server, context);

    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(context.shouldPrompt).toBe(false);
  });
});
