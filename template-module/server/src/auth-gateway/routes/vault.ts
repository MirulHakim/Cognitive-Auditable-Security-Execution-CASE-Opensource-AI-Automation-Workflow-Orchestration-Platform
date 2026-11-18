import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, GatewayError } from "../errors.js";
import type { VaultService } from "../vaultService.js";
import { VAULT_MAX_PLAINTEXT_BYTES, VAULT_PROVIDERS } from "../vault.js";

/**
 * Browser-facing vault API. Mounted AFTER authentication, so the operator id
 * always comes from the verified session — the request body cannot address
 * another member.
 *
 * Response discipline:
 *  - status returns booleans only;
 *  - connect acknowledges the write, never echoes the token;
 *  - disconnect acknowledges deletion;
 *  - no endpoint ever returns ciphertext or plaintext. A member can see that a
 *    credential exists, not what it is.
 */

const ProviderSchema = z.enum(VAULT_PROVIDERS);

const ConnectSecretSchema = z
  .object({
    token: z
      .string()
      .min(1, "Enter the credential to connect.")
      .max(VAULT_MAX_PLAINTEXT_BYTES, "That credential is too large.")
      .refine(
        (value) => Buffer.byteLength(value.trim(), "utf8") <= VAULT_MAX_PLAINTEXT_BYTES,
        { message: "That credential is too large." },
      )
      .refine((value) => value.trim().length > 0, {
        message: "Enter the credential to connect.",
      }),
  })
  .strict();

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new GatewayError(401, "UNAUTHENTICATED", "Authentication required.");
  }
  return req.auth;
}

function readProvider(req: Request) {
  const parsed = ProviderSchema.safeParse(req.params.provider);
  if (!parsed.success) {
    throw new GatewayError(
      400,
      "UNSUPPORTED_VAULT_PROVIDER",
      "Vault supports the telegram and gmail providers only.",
      { providers: [...VAULT_PROVIDERS] },
    );
  }
  return parsed.data;
}

function noStore(res: Response): void {
  res.setHeader("cache-control", "private, no-store");
}

export function createVaultRouter(deps: { service: VaultService }): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const status = await deps.service.status(auth.operator.id);
      noStore(res);
      res.json(status);
    }),
  );

  router.post(
    "/:provider",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const provider = readProvider(req);

      const parsed = ConnectSecretSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new GatewayError(
          400,
          "INVALID_VAULT_SECRET",
          "Send a JSON body of the form { \"token\": \"...\" }.",
          { fields: parsed.error.issues.map((issue) => issue.path.join(".")) },
        );
      }

      // Only the trimmed value is stored: trailing newlines pasted from a
      // terminal are a common source of authentication failures.
      const result = await deps.service.connect(
        auth.operator.id,
        provider,
        parsed.data.token.trim(),
      );
      noStore(res);
      res.status(200).json({
        provider: result.provider,
        connected: true,
        updatedAt: result.updatedAt.toISOString(),
      });
    }),
  );

  router.delete(
    "/:provider",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const provider = readProvider(req);
      const deleted = await deps.service.disconnect(auth.operator.id, provider);
      noStore(res);
      // Idempotent: disconnecting twice is not an error, so a retried request
      // (or a stale browser tab) cannot report a false failure.
      res.status(200).json({ provider, connected: false, deleted });
    }),
  );

  return router;
}
