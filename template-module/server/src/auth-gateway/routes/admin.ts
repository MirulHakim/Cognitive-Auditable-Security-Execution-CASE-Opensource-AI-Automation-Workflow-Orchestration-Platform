import { Router } from "express";
import { z } from "zod";
import type { AuthAuditor } from "../audit.js";
import { asyncHandler, GatewayError } from "../errors.js";
import type { AuthStore } from "../store.js";

/**
 * Hard revocation, gateway-side only.
 *
 * `DELETE /api/auth/operators/:id` (admin JWT, same-origin) removes the member
 * completely:
 *   - `auth_accounts` (Google subject link + delegated tokens),
 *   - `auth_refresh_tokens` (no more silent refresh),
 *   - the `operators` row itself.
 *
 * Active access tokens die on the next request: the middleware re-reads the
 * operator and answers 401 SESSION_INVALID when it no longer exists. Access
 * tokens are therefore never "revoked" one by one — there is no list to walk.
 *
 * History is handled by the base schema's ON DELETE SET NULL on
 * created_by/reviewed_by/performed_by, and by clearing
 * `auth_invitations.invited_by` (migration 003) so an admin who once invited
 * someone remains deletable. The person can return only through a brand-new
 * invitation, which creates a new operator id and a new Google link.
 *
 * Scope note: `operators` has no "root admin" flag, so root admin here means
 * role `admin` (singular by design: invitations can only create operator or
 * auditor, and the legacy role switch refuses admin). Self-revocation is
 * refused so a lone admin cannot lock the workspace out.
 */

const MemberIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, "Invalid member id.");

export const HARD_REVOKE_REASON = "ADMIN_HARD_DELETE";

export function createHardRevokeRouter(deps: {
  store: AuthStore;
  audit: AuthAuditor;
}): Router {
  const router = Router();

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) {
        throw new GatewayError(401, "UNAUTHENTICATED", "Authentication required.");
      }

      const parsed = MemberIdSchema.safeParse(req.params.id);
      if (!parsed.success) {
        throw new GatewayError(404, "OPERATOR_NOT_FOUND", "Member not found.");
      }
      const targetId = parsed.data;

      if (targetId === auth.operator.id) {
        throw new GatewayError(
          409,
          "SELF_REVOKE_FORBIDDEN",
          "You cannot revoke your own account.",
        );
      }

      const target = await deps.store.findOperatorById(targetId);
      if (!target) {
        throw new GatewayError(404, "OPERATOR_NOT_FOUND", "Member not found.");
      }

      // Captured before the row disappears; only hashes/counts reach the chain.
      const email = target.email;
      const role = target.role;

      const result = await deps.store.deleteOperator(targetId);
      if (!result.deleted) {
        throw new GatewayError(404, "OPERATOR_NOT_FOUND", "Member not found.");
      }

      deps.audit.operatorRevoked({
        actorId: auth.operator.id,
        actorRole: auth.operator.role,
        operatorId: targetId,
        role,
        email,
        reasonCode: HARD_REVOKE_REASON,
        accountsDeleted: result.accounts,
        refreshTokensDeleted: result.refreshTokens,
        invitationsUnlinked: result.invitationsUnlinked,
        workspaceId: auth.claims.workspaceId,
      });

      res.setHeader("cache-control", "no-store");
      res.json({
        revoked: true,
        operatorId: targetId,
        deleted: {
          accounts: result.accounts,
          refreshTokens: result.refreshTokens,
          invitationsUnlinked: result.invitationsUnlinked,
        },
      });
    }),
  );

  return router;
}
