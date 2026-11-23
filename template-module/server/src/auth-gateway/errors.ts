import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Error shape shared with the existing Express API: { error: { code, message, details } }. */
export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function gatewayErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (err instanceof GatewayError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  const body = err as { type?: string; status?: number } | null;
  if (body?.type === "entity.parse.failed") {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Request body is not valid JSON.", details: null },
    });
    return;
  }
  if (body?.type === "entity.too.large") {
    res.status(413).json({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large.", details: null },
    });
    return;
  }

  // The gateway never forwards stack traces or tokens to the browser.
  console.error("[auth-gateway]", err instanceof Error ? err.stack ?? err.message : err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Unexpected authentication error.", details: null },
  });
}
