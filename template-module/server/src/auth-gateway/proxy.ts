import httpProxy from "http-proxy";
import type { RequestHandler } from "express";
import type { AuthGatewayConfig } from "./config.js";
import { GatewayError } from "./errors.js";

export function isFastApiPath(path: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * One HTTP hop in front of both existing backends. The Node API and FastAPI
 * need no code change: they receive the same paths, bodies and the legacy
 * identity headers the gateway injected.
 *
 * Bodies are never parsed here. Express's json() middleware would consume the
 * stream and the proxy would forward an empty request; local auth routes parse
 * their own (small) bodies instead.
 */
export function createProxy(config: AuthGatewayConfig): RequestHandler {
  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true,
    proxyTimeout: 120_000,
    timeout: 120_000,
  });

  proxy.on("error", (error, _req, res) => {
    console.error("[auth-gateway][proxy]", error.message);
    const response = res as unknown as {
      headersSent?: boolean;
      writeHead?: (status: number, headers: Record<string, string>) => void;
      end?: (body?: string) => void;
      destroy?: () => void;
    };
    if (response.headersSent) {
      response.destroy?.();
      return;
    }
    response.writeHead?.(502, { "content-type": "application/json" });
    response.end?.(
      JSON.stringify({
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "The upstream service is unavailable.",
          details: null,
        },
      }),
    );
  });

  return (req, res, next) => {
    // This middleware is mounted at /api, so req.path is relative. Routing
    // decisions and the forwarded URL must use the full original path.
    const path = req.originalUrl.split("?")[0] ?? req.path;
    const target = isFastApiPath(path, config.fastapiPrefixes)
      ? config.fastapiUrl
      : config.nodeApiUrl;

    if (!target) {
      next(
        new GatewayError(
          503,
          "UPSTREAM_NOT_CONFIGURED",
          "This API route has no configured backend.",
        ),
      );
      return;
    }

    try {
      // Identity headers are never client-controlled here: stripIdentityHeaders
      // deleted x-operator-id / x-operator-role / x-mock-* before authentication,
      // and createAuthenticate re-issued only the values resolved from the
      // verified session. The proxy intentionally adds nothing from req.body or
      // query parameters.
      //
      // Express mounts this middleware at /api, which rewrites req.url to the
      // remainder. http-proxy uses req.url, so restore the full path (and query)
      // or every upstream request would lose its /api prefix.
      req.url = req.originalUrl;
      proxy.web(req, res, { target });
    } catch (error) {
      next(error);
    }
  };
}
