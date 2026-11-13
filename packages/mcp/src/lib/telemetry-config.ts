export function telemetryIsDisabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true";
}

export function embeddedPrometheusIsEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (telemetryIsDisabled(environment)) return false;

  const configuredExporters = environment.OTEL_METRICS_EXPORTER;
  if (!configuredExporters) return true;

  return configuredExporters
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes("prometheus");
}
