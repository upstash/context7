import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";

const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;

interface StdioInputLifecycle {
  once(event: "close" | "end", listener: () => void): unknown;
}

interface ProcessSignalLifecycle {
  once(event: "SIGHUP", listener: () => void): unknown;
}

interface StdioShutdownOptions {
  exit?: (code: number) => void;
  flush?: () => Promise<void>;
  flushTimeoutMs?: number;
  input?: StdioInputLifecycle;
  onerror?: (error: unknown) => void;
  signals?: ProcessSignalLifecycle;
}

/**
 * Closes the SDK-owned stdio connection before exiting. This is intentionally
 * idempotent because Node commonly emits both `end` and `close` for stdin.
 */
export function installStdioShutdown(
  handle: StdioServerHandle,
  options: StdioShutdownOptions = {}
): () => void {
  const input = options.input ?? process.stdin;
  const signals = options.signals ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const flushTimeoutMs = options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  let shutdownPromise: Promise<void> | undefined;

  const reportError = (error: unknown): void => {
    try {
      options.onerror?.(error);
    } catch {
      // A reporting callback must not prevent shutdown.
    }
  };

  const shutdown = (): void => {
    shutdownPromise ??= (async () => {
      let exitCode = 0;
      try {
        await handle.close();
      } catch (error) {
        exitCode = 1;
        reportError(error);
      }

      try {
        if (options.flush) {
          let timeout: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              options.flush(),
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                  () => reject(new Error(`OpenTelemetry flush exceeded ${flushTimeoutMs}ms`)),
                  flushTimeoutMs
                );
              }),
            ]);
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        }
      } catch (error) {
        reportError(error);
      }
      exit(exitCode);
    })();
  };

  input.once("end", shutdown);
  input.once("close", shutdown);
  signals.once("SIGHUP", shutdown);
  return shutdown;
}
