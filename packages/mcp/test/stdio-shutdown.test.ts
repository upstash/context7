import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { installStdioShutdown } from "../src/lib/stdio-shutdown.js";

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
  }
  throw lastError;
}

describe("stdio process shutdown", () => {
  test("closes and flushes once before a successful exit", async () => {
    const events: string[] = [];
    const input = new EventEmitter();
    const signals = new EventEmitter();
    const handle: StdioServerHandle = {
      close: async () => {
        events.push("close");
      },
    };

    installStdioShutdown(handle, {
      exit: (code) => events.push(`exit:${code}`),
      flush: async () => {
        events.push("flush");
      },
      input,
      signals,
    });
    input.emit("end");
    input.emit("close");
    signals.emit("SIGHUP");

    await eventually(() => expect(events).toEqual(["close", "flush", "exit:0"]));
  });

  test("flushes recorded terminal metrics and exits nonzero when close rejects", async () => {
    const failure = new Error("close failed");
    const errors: unknown[] = [];
    const events: string[] = [];
    const input = new EventEmitter();
    const signals = new EventEmitter();

    installStdioShutdown(
      {
        close: async () => {
          events.push("close");
          throw failure;
        },
      },
      {
        exit: (code) => events.push(`exit:${code}`),
        flush: async () => {
          events.push("flush");
        },
        input,
        onerror: (error) => errors.push(error),
        signals,
      }
    );
    signals.emit("SIGHUP");

    await eventually(() => expect(events).toEqual(["close", "flush", "exit:1"]));
    expect(errors).toEqual([failure]);
  });

  test("exits after the deadline when an external metrics flush never settles", async () => {
    const errors: unknown[] = [];
    const exits: number[] = [];
    const input = new EventEmitter();
    const signals = new EventEmitter();

    installStdioShutdown(
      { close: async () => undefined },
      {
        exit: (code) => exits.push(code),
        flush: () => new Promise<void>(() => undefined),
        flushTimeoutMs: 10,
        input,
        onerror: (error) => errors.push(error),
        signals,
      }
    );
    input.emit("end");

    await eventually(() => expect(exits).toEqual([0]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: "OpenTelemetry flush exceeded 10ms" });
  });
});
