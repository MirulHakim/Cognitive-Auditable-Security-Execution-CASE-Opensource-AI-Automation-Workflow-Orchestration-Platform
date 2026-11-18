import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { asyncHandler, GatewayError } from "../errors.js";
import { VaultDecryptionError, type VaultService } from "../vaultService.js";
import { VAULT_PROVIDERS } from "../vault.js";

/**
 * Internal, just-in-time decryption for the AI workflow engine.
 *
 * This route is mounted BEFORE the browser session middleware and is not
 * reachable with a user cookie. It requires a pre-shared key in
 * `x-internal-api-key`, compared in constant time:
 *
 *   GET /api/internal/vault/:operator_id/:provider
 *   x-internal-api-key: <VAULT_INTERNAL_API_KEY>
 *
 * If VAULT_INTERNAL_API_KEY is unset the route answers 503 rather than falling
 * back to session authentication or running unauthenticated. The workflow
 * engine should call this only at the moment a workflow step needs the token,
 * keep it in memory for that execution, and never persist or log it.
 *
 * The response is no-store, and failures never include the ciphertext, the
 * plaintext, or cryptographic detail.
 */

const INTERNAL_KEY_HEADER = "x-internal-api-key";

const ParamsSchema = z.object({
  operator_id: z.string().trim().min(1).max(128),
  provider: z.enum(VAULT_PROVIDERS),
});

function keyMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch; compare lengths in constant
  // time first so a wrong-length key is simply false.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireInternalKey(expected: string | null): RequestHandler {
  return (req, _res, next) => {
    if (!expected) {
      next(
        new GatewayError(
          503,
          "INTERNAL_VAULT_DISABLED",
          "Internal vault decryption is not configured.",
        ),
      );
      return;
    }
    const presented = req.header(INTERNAL_KEY_HEADER)?.trim() ?? "";
    if (!presented || !keyMatches(presented, expected)) {
      next(
        new GatewayError(
          401,
          "INTERNAL_UNAUTHENTICATED",
          "A valid internal API key is required.",
        ),
      );
      return;
    }
    next();
  };
}

export function createInternalVaultRouter(deps: {
  service: VaultService;
  internalApiKey: string | null;
}): Router {
  const router = Router();
  router.use(requireInternalKey(deps.internalApiKey));

  router.get(
    "/:operator_id/:provider",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = ParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new GatewayError(
          400,
          "INVALID_VAULT_LOOKUP",
          "Provide a valid operator id and provider (telegram or gmail).",
        );
      }

      let revealed;
      try {
        revealed = await deps.service.reveal(
          parsed.data.operator_id,
          parsed.data.provider,
        );
      } catch (error) {
        if (error instanceof VaultDecryptionError) {
          // Deliberately no detail: distinguishing "wrong key" from "tampered
          // row" would help an attacker and the engine can only retry/abort.
          console.error(
            "[auth-gateway][vault] internal decryption failed for operator",
            parsed.data.operator_id,
            "provider",
            parsed.data.provider,
          );
          throw new GatewayError(
            500,
            "VAULT_DECRYPTION_FAILED",
            "The stored credential could not be decrypted.",
          );
        }
        throw error;
      }

      if (!revealed) {
        throw new GatewayError(
          404,
          "VAULT_SECRET_NOT_FOUND",
          "No credential is connected for that operator and provider.",
        );
      }

      res.setHeader("cache-control", "private, no-store");
      res.setHeader("pragma", "no-cache");
      res.json({
        operatorId: revealed.operatorId,
        provider: revealed.provider,
        secret: revealed.secret,
        updatedAt: revealed.updatedAt.toISOString(),
      });
    }),
  );

  return router;
}
