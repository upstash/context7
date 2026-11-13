import type { ErrorRequestHandler } from "express";

// Error boundary for the MCP router's JSON body parser. express.json() reports
// a body it will not accept via next(err); left unhandled, Express answers with
// an HTML stack trace naming dependency versions and absolute paths.
export const mcpBodyErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const { status, type } = err as { status?: unknown; type?: unknown };

  // body-parser tags every rejection with a 4xx; anything else is not a body
  // problem. Once a response has started, only Express can wind it down.
  if (typeof status !== "number" || status < 400 || status >= 500 || res.headersSent) {
    return next(err);
  }

  // Method, path and size only: the body is the rejected input, and the
  // headers carry the API key.
  console.error(
    `Rejected request body (${status}, ${String(type ?? "unknown")}): ${req.method} ${req.baseUrl}${req.path} bytes=${req.headers["content-length"] ?? "unknown"}`
  );

  // Fixed messages: body-parser's own quote offsets into the body.
  const parseFailure = err instanceof SyntaxError && type === "entity.parse.failed";
  res.status(status).json({
    jsonrpc: "2.0",
    error: parseFailure
      ? { code: -32700, message: "Parse error" }
      : { code: -32600, message: "Invalid Request" },
    id: null,
  });
};
