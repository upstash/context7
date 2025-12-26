import crypto from "crypto";

export type ErrorType =
  | "network_error"
  | "rate_limit"
  | "auth_error"
  | "not_found"
  | "server_error"
  | "validation_error"
  | "unknown";

export interface ClientInfo {
  ide?: string;
  version?: string;
  clientId?: string;
}

export interface RequestUserContext {
  apiKeyHash?: string;
  clientIp?: string;
  clientInfo?: ClientInfo;
}

export interface TelemetryEvent {
  timestamp: number;
  eventType: "tool_call" | "api_call" | "error";
  name?: string;
  duration?: number;
  success: boolean;
  errorType?: ErrorType;
  errorMessage?: string;
  statusCode?: number;
  clientInfo?: ClientInfo;
  metadata?: Record<string, unknown>;
}

export interface TelemetryConfig {
  endpoint?: string;
  enabled?: boolean;
  flushInterval?: number;
  batchSize?: number;
  serverVersion?: string;
  transport?: "stdio" | "http";
}

interface TelemetryPayload {
  events: TelemetryEvent[];
  serverVersion: string;
  transport: string;
  sentAt: number;
}

let config: Required<TelemetryConfig> = {
  // endpoint: process.env.TELEMETRY_ENDPOINT || "https://context7.com/api/v2/telemetry",
  endpoint: "http://localhost:3000/api/v2/telemetry",
  enabled: process.env.TELEMETRY_ENABLED !== "false",
  flushInterval: parseInt(process.env.TELEMETRY_FLUSH_INTERVAL || "30000", 10),
  batchSize: parseInt(process.env.TELEMETRY_BATCH_SIZE || "100", 10),
  serverVersion: "1.0.33",
  transport: "stdio",
};

let eventBuffer: TelemetryEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let clientContext: ClientInfo = {};
let stdioSessionId: string | null = null;

function getOrCreateStdioSessionId(): string {
  if (!stdioSessionId) {
    stdioSessionId = `stdio_session_${crypto.randomUUID()}`;
  }
  return stdioSessionId;
}

function generateClientIdFromContext(ctx: RequestUserContext): string | null {
  if (ctx.apiKeyHash) {
    return `apikey_${ctx.apiKeyHash.substring(0, 16)}`;
  }

  if (ctx.clientIp) {
    const hash = simpleHash(ctx.clientIp);
    return `ip_${hash}`;
  }

  return null;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export function initTelemetry(userConfig: TelemetryConfig): void {
  config = {
    ...config,
    ...userConfig,
    endpoint: userConfig.endpoint || config.endpoint,
    enabled: userConfig.enabled ?? config.enabled,
    flushInterval: userConfig.flushInterval || config.flushInterval,
    batchSize: userConfig.batchSize || config.batchSize,
  };

  if (config.enabled && !flushTimer) {
    flushTimer = setInterval(() => {
      flush().catch((err) => {
        console.error("[Telemetry] Flush error:", err);
      });
    }, config.flushInterval);

    flushTimer.unref();
  }
}

export function setClientContext(info: ClientInfo): void {
  clientContext = { ...clientContext, ...info };
}

export function getClientContext(): ClientInfo {
  return { ...clientContext };
}

export function classifyError(error: Error | Response | number): ErrorType {
  if (typeof error === "number") {
    if (error === 429) return "rate_limit";
    if (error === 401 || error === 403) return "auth_error";
    if (error === 404) return "not_found";
    if (error >= 500) return "server_error";
    return "unknown";
  }

  if (error instanceof Response || (error && "status" in error)) {
    const status = (error as Response).status;
    return classifyError(status);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (
      message.includes("fetch") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("timeout")
    ) {
      return "network_error";
    }

    if (message.includes("validation") || message.includes("invalid")) {
      return "validation_error";
    }
  }

  return "unknown";
}

function recordEvent(event: TelemetryEvent, userContext?: RequestUserContext): void {
  if (!config.enabled) return;

  let clientId =
    event.clientInfo?.clientId || userContext?.clientInfo?.clientId || clientContext.clientId;

  if (!clientId && userContext) {
    clientId = generateClientIdFromContext(userContext) || getOrCreateStdioSessionId();
  } else if (!clientId) {
    clientId = getOrCreateStdioSessionId();
  }

  const baseClientInfo = userContext?.clientInfo || clientContext;

  event.clientInfo = {
    ...baseClientInfo,
    ...event.clientInfo,
    clientId,
  };

  eventBuffer.push(event);

  if (eventBuffer.length >= config.batchSize) {
    flush().catch((err) => {
      console.error("[Telemetry] Flush error:", err);
    });
  }
}

export async function trackToolCall<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
  userContext?: RequestUserContext
): Promise<T> {
  if (!config.enabled) {
    return fn();
  }

  const start = Date.now();
  let success = true;
  let errorType: ErrorType | undefined;
  let errorMessage: string | undefined;

  try {
    const result = await fn();
    return result;
  } catch (error) {
    success = false;
    errorType = classifyError(error as Error);
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    recordEvent(
      {
        timestamp: start,
        eventType: "tool_call",
        name,
        duration: Date.now() - start,
        success,
        errorType,
        errorMessage,
        metadata,
      },
      userContext
    );
  }
}

export async function trackApiCall<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
  userContext?: RequestUserContext
): Promise<T> {
  if (!config.enabled) {
    return fn();
  }

  const start = Date.now();
  let success = true;
  let errorType: ErrorType | undefined;
  let errorMessage: string | undefined;
  let statusCode: number | undefined;

  try {
    const result = await fn();

    if (result && typeof result === "object" && "status" in result) {
      statusCode = (result as { status: number }).status;
      if (statusCode >= 400) {
        success = false;
        errorType = classifyError(statusCode);
      }
    }

    return result;
  } catch (error) {
    success = false;
    errorType = classifyError(error as Error);
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    recordEvent(
      {
        timestamp: start,
        eventType: "api_call",
        name,
        duration: Date.now() - start,
        success,
        errorType,
        errorMessage,
        statusCode,
        metadata,
      },
      userContext
    );
  }
}

export function trackError(
  error: Error,
  context: { tool?: string; api?: string; metadata?: Record<string, unknown> }
): void {
  if (!config.enabled) return;

  recordEvent({
    timestamp: Date.now(),
    eventType: "error",
    name: context.tool || context.api,
    success: false,
    errorType: classifyError(error),
    errorMessage: error.message,
    metadata: context.metadata,
  });
}

export async function flush(): Promise<void> {
  if (!config.enabled || eventBuffer.length === 0) {
    return;
  }

  const eventsToSend = eventBuffer;
  eventBuffer = [];

  const payload: TelemetryPayload = {
    events: eventsToSend,
    serverVersion: config.serverVersion,
    transport: config.transport,
    sentAt: Date.now(),
  };

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[Telemetry] Failed to send events: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error("[Telemetry] Failed to send events:", error);
  }
}

export async function shutdown(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  await flush();
}

export function getBufferSize(): number {
  return eventBuffer.length;
}

export function isEnabled(): boolean {
  return config.enabled;
}
