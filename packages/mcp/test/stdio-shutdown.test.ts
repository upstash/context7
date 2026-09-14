import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { installProcessShutdown } from "../src/lib/process-shutdown.js";

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

describe("process shutdown", () => {
  test("closes and flushes once across SIGTERM and overlapping termination events", async () => {
    const events: string[] = [];
    const input = new EventEmitter();
    const signals = new EventEmitter();
    const handle: StdioServerHandle = {
      close: async () => {
        events.push("close");
      },
    };

    installProcessShutdown(handle, {
      exit: (code) => events.push(`exit:${code}`),
      flush: async () => {
        events.push("flush");
      },
      input,
      signals,
    });
    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    signals.emit("SIGHUP");
    input.emit("end");
    input.emit("close");

    await eventually(() => expect(events).toEqual(["close", "flush", "exit:0"]));
  });

  test("flushes recorded terminal metrics and exits nonzero when close rejects", async () => {
    const failure = new Error("close failed");
    const errors: unknown[] = [];
    const events: string[] = [];
    const input = new EventEmitter();
    const signals = new EventEmitter();

    installProcessShutdown(
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
    signals.emit("SIGINT");

    await eventually(() => expect(events).toEqual(["close", "flush", "exit:1"]));
    expect(errors).toEqual([failure]);
  });

  test("exits after the deadline when an external metrics flush never settles", async () => {
    const errors: unknown[] = [];
    const exits: number[] = [];
    const input = new EventEmitter();
    const signals = new EventEmitter();

    installProcessShutdown(
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

  test("flushes and exits nonzero after the deadline when close never settles", async () => {
    const errors: unknown[] = [];
    const events: string[] = [];
    const signals = new EventEmitter();

    installProcessShutdown(
      { close: () => new Promise<void>(() => undefined) },
      {
        closeTimeoutMs: 10,
        exit: (code) => events.push(`exit:${code}`),
        flush: async () => {
          events.push("flush");
        },
        onerror: (error) => errors.push(error),
        signals,
      }
    );
    signals.emit("SIGTERM");

    await eventually(() => expect(events).toEqual(["flush", "exit:1"]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: "Server close exceeded 10ms" });
  });
});
