import { Context7Error } from "@error";

export type AbortState = {
  signal?: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
};

export function validateTimeout(timeout: number | false): void {
  if (timeout !== false && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new TypeError("timeout must be a positive number or false");
  }
}

export function resolveSignal(signal?: AbortSignal | (() => AbortSignal)): AbortSignal | undefined {
  return typeof signal === "function" ? signal() : signal;
}

export function createAbortState(
  signals: Array<AbortSignal | undefined>,
  timeout: number | false
): AbortState {
  validateTimeout(timeout);

  const activeSignals = [
    ...new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined)),
  ];
  if (timeout === false && activeSignals.length === 0) {
    return { timedOut: () => false, cleanup: () => undefined };
  }

  const controller = new AbortController();
  let didTimeOut = false;
  const listeners = new Map<AbortSignal, () => void>();

  for (const signal of activeSignals) {
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
    listeners.set(signal, abort);
  }

  const timer =
    timeout === false
      ? undefined
      : setTimeout(() => {
          didTimeOut = true;
          controller.abort(new Error(`Request timed out after ${timeout}ms`));
        }, timeout);

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

export function abortError(cause: unknown, timedOut: boolean): Context7Error {
  return new Context7Error(timedOut ? "Request timed out" : "Request was aborted", {
    code: timedOut ? "request_timeout" : "request_aborted",
    retryable: timedOut,
    cause,
  });
}

export function isContext7AbortError(error: unknown): boolean {
  return (
    error instanceof Context7Error &&
    (error.code === "request_aborted" || error.code === "request_timeout")
  );
}

export async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("Request was aborted"));
    };

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
