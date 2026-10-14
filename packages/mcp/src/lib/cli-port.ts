/** Strict `--port` validation shared by the CLI entrypoint. */
export const parsePortOption = (raw: string | undefined): number | undefined => {
  const parsed = /^\d+$/.test(raw ?? "") ? parseInt(raw as string, 10) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.error(`Invalid --port value: '${raw}'. Must be an integer 1-65535.`);
    process.exit(1);
  }
  return parsed;
};
