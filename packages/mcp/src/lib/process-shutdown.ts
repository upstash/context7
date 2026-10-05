const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;

interface ShutdownHandle {
  close(): Promise<void>;
}

interface InputLifecycle {
  once(event: "close" | "end", listener: () => void): unknown;
}

interface SignalLifecycle {
  once(event: "SIGHUP" | "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

interface ProcessShutdownOptions {
  closeTimeoutMs?: number;
  exit?: (code: number) => void;
  flush?: () => Promise<void>;
  flushTimeoutMs?: number;
  input?: InputLifecycle;
  onerror?: (error: unknown) => void;
  signals?: SignalLifecycle;
}

async function withTimeout(
  operation: () => Promise<void>,
  timeoutMs: number,
  description: string
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${description} exceeded ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Coordinates one bounded, idempotent process shutdown for HTTP and stdio.
 * Passing an input lifecycle additionally treats stdio EOF as termination.
 */
export function installProcessShutdown(
  handle: ShutdownHandle,
  options: ProcessShutdownOptions = {}
): () => void {
  const signals = options.signals ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
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
        await withTimeout(() => handle.close(), closeTimeoutMs, "Server close");
      } catch (error) {
        exitCode = 1;
        reportError(error);
      }

      try {
        if (options.flush) {
          await withTimeout(options.flush, flushTimeoutMs, "OpenTelemetry flush");
        }
      } catch (error) {
        reportError(error);
      }
      exit(exitCode);
    })();
  };

  options.input?.once("end", shutdown);
  options.input?.once("close", shutdown);
  signals.once("SIGHUP", shutdown);
  signals.once("SIGINT", shutdown);
  signals.once("SIGTERM", shutdown);
  return shutdown;
}
