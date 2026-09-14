import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolCallOutcome } from "./tool-names.js";

export interface McpOperationErrorTarget {
  errorType?: string;
  toolOutcome?: ToolCallOutcome;
}

const operationScope = new AsyncLocalStorage<McpOperationErrorTarget>();

export function runInMcpOperationScope<T>(target: McpOperationErrorTarget, callback: () => T): T {
  return operationScope.run(target, callback);
}

export function markCurrentMcpOperationError(errorType = "tool_error"): void {
  const target = operationScope.getStore();
  if (target) target.errorType = errorType;
}

export function markCurrentMcpToolOutcome(outcome: ToolCallOutcome): void {
  const target = operationScope.getStore();
  if (target) target.toolOutcome = outcome;
}
