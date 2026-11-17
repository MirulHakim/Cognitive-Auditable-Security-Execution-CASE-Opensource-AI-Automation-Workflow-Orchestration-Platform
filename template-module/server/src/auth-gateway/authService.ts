import type { Role } from "../auth/operators.js";
import type { AuthAuditor } from "./audit.js";
import type { AuthGatewayConfig } from "./config.js";
import type { CredentialService } from "./credentials.js";
import { GatewayError } from "./errors.js";
import type { GoogleExchangeResult, GoogleOAuth, GoogleProfile } from "./google.js";
import type { AuthStore, OperatorRecord } from "./store.js";
import {
  constantTimeEqual,
  newOpaqueToken,
  sha256Hex,
  type OAuthStateService,
  type SessionTokenService,
} from "./tokens.js";

export class AuthFailure extends Error {
  readonly reasonCode: string;
  readonly email: string | null;
  readonly operator: { id: string; role: Role } | null;

  constructor(
    reasonCode: string,
    options: { email?: string | null; operator?: { id: string; role: Role } | null } = {},
  ) {
    super(reasonCode);
    this.name = "AuthFailure";
    this.reasonCode = reasonCode;
    this.email = options.email ?? null;
    this.operator = options.operator ?? null;
  }
}

export interface IssuedSession {
  operator: OperatorRecord;
  accessToken: string;
  refreshToken: string;
  rootAdminInitialized: boolean;
}

export interface AuthService {
  begin(): Promise<{ url: string; stateCookie: string }>;
  complete(input: {
    code: string | undefined;
    state: string | undefined;
    stateCookie: string | undefined;
  }): Promise<IssuedSession>;
  refresh(rawRefreshToken: string | undefined): Promise<IssuedSession>;
  /** Revokes the refresh token; returns the owner when a real session ended. */
  logout(rawRefreshToken: string | undefined): Promise<{ operatorId: string } | null>;
}

export function createAuthService(deps: {
  config: AuthGatewayConfig;
  store: AuthStore;
  tokens: SessionTokenService;
  oauthState: OAuthStateService;
  google: GoogleOAuth;
  audit: AuthAuditor;
  /** Optional: absent in tests that do not exercise Gmail delegation. */
  credentials?: CredentialService;
  now?: () => Date;
}): AuthService {
  const now = deps.now ?? (() => new Date());

  async function issue(operator: OperatorRecord): Promise<IssuedSession> {
    const accessToken = await deps.tokens.sign(operator);
    const refreshToken = newOpaqueToken();
    await deps.store.createRefreshToken({
      tokenHash: sha256Hex(refreshToken),
      operatorId: operator.id,
      expiresAt: new Date(now().getTime() + deps.config.jwt.refreshTtlSeconds * 1000),
    });
    return { operator, accessToken, refreshToken, rootAdminInitialized: false };
  }

  async function resolveOperator(profile: GoogleProfile): Promise<{
    operator: OperatorRecord;
    rootAdminInitialized: boolean;
  }> {
    const bootstrap = await deps.store.bootstrapRootAdmin({
      googleSub: profile.sub,
      email: profile.email,
      displayName: profile.name,
      workspaceId: deps.config.workspaceId,
    });

    if (bootstrap.created) {
      if (!bootstrap.operator) throw new AuthFailure("BOOTSTRAP_FAILED");
      deps.audit.rootAdminInitialized({
        operatorId: bootstrap.operator.id,
        role: bootstrap.operator.role,
        workspaceId: deps.config.workspaceId,
      });
      return { operator: bootstrap.operator, rootAdminInitialized: true };
    }

    const linked = await deps.store.findAccountByGoogleSub(profile.sub);
    if (linked) {
      return { operator: linked.operator, rootAdminInitialized: false };
    }

    const byEmail = await deps.store.findOperatorByEmail(profile.email);
    if (!byEmail) {
      // A valid Google account with no operator row has not been invited. We
      // deliberately do not create one implicitly.
      throw new AuthFailure("INVITATION_REQUIRED", { email: profile.email });
    }
    if (byEmail.revokedAt) {
      throw new AuthFailure("ACCESS_REVOKED", {
        email: profile.email,
        operator: { id: byEmail.id, role: byEmail.role },
      });
    }

    const operator = await deps.store.linkAccount({
      googleSub: profile.sub,
      operatorId: byEmail.id,
      email: profile.email,
    });
    if (!operator) {
      throw new AuthFailure("IDENTITY_CONFLICT", {
        email: profile.email,
        operator: { id: byEmail.id, role: byEmail.role },
      });
    }
    return { operator, rootAdminInitialized: false };
  }

  return {
    async begin() {
      // 32 random bytes make the state unguessable; the signed cookie binds it
      // to this browser, so a callback cannot be replayed from another session.
      const state = newOpaqueToken();
      const nonce = newOpaqueToken();
      const stateCookie = await deps.oauthState.sign({ state, nonce });
      return {
        url: deps.google.authorizationUrl({ state, nonce }),
        stateCookie,
      };
    },

    async complete({ code, state, stateCookie }) {
      let knownEmail: string | null = null;
      try {
        let expectedState: string;
        let nonce: string;
        try {
          if (!stateCookie) throw new Error("missing state cookie");
          const parsed = await deps.oauthState.verify(stateCookie);
          expectedState = parsed.state;
          nonce = parsed.nonce;
        } catch {
          throw new AuthFailure("OAUTH_STATE_INVALID");
        }
        if (!state || !constantTimeEqual(state, expectedState)) {
          throw new AuthFailure("OAUTH_STATE_INVALID");
        }
        if (!code) throw new AuthFailure("OAUTH_CODE_MISSING");

        let exchange: GoogleExchangeResult;
        try {
          exchange = await deps.google.exchangeCode(code, nonce);
        } catch {
          // Never surface Google's message: it can contain token fragments.
          throw new AuthFailure("GOOGLE_EXCHANGE_FAILED");
        }
        const profile = exchange.profile;
        knownEmail = profile.email;

        const { operator, rootAdminInitialized } = await resolveOperator(profile);

        // The account row exists from here on (bootstrap or link), so the tokens
        // from this consent can be sealed against it. A failure to store them
        // must not block sign-in: the admin keeps working, merely without
        // delegated Gmail until they sign in again.
        if (deps.credentials) {
          try {
            await deps.credentials.saveFromExchange(profile.sub, exchange.tokens);
          } catch (error) {
            console.error(
              "[auth-gateway] could not persist delegated Google tokens:",
              error instanceof Error ? error.message : error,
            );
          }
        }
        if (operator.revokedAt) {
          throw new AuthFailure("ACCESS_REVOKED", {
            email: profile.email,
            operator: { id: operator.id, role: operator.role },
          });
        }
        await deps.store.touchAccount(profile.sub, profile.email);
        const session = await issue(operator);
        deps.audit.authenticationSucceeded({
          operatorId: operator.id,
          role: operator.role,
          email: operator.email,
          workspaceId: deps.config.workspaceId,
        });
        return { ...session, rootAdminInitialized };
      } catch (error) {
        // Exactly one failure event per callback attempt, whichever step failed.
        if (error instanceof AuthFailure) {
          deps.audit.authenticationFailed({
            reasonCode: error.reasonCode,
            email: error.email ?? knownEmail,
            operator: error.operator,
            workspaceId: deps.config.workspaceId,
          });
        }
        throw error;
      }
    },

    async refresh(rawRefreshToken) {
      if (!rawRefreshToken) {
        throw new GatewayError(401, "REFRESH_REQUIRED", "No refresh session.");
      }
      const newRefresh = newOpaqueToken();
      const rotated = await deps.store.rotateRefreshToken({
        oldTokenHash: sha256Hex(rawRefreshToken),
        newTokenHash: sha256Hex(newRefresh),
        newExpiresAt: new Date(now().getTime() + deps.config.jwt.refreshTtlSeconds * 1000),
        now: now(),
      });

      if (rotated.status === "reuse") {
        throw new GatewayError(
          401,
          "REFRESH_REUSE",
          "This session was already rotated. Sign in again.",
        );
      }
      if (rotated.status !== "ok") {
        throw new GatewayError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again.");
      }

      const operator = await deps.store.findOperatorById(rotated.operatorId);
      if (!operator) {
        throw new GatewayError(401, "SESSION_INVALID", "Unknown session identity.");
      }
      if (operator.revokedAt) {
        throw new GatewayError(
          403,
          "ACCESS_REVOKED",
          "This member's access to the workspace has been revoked by an administrator.",
        );
      }

      const accessToken = await deps.tokens.sign(operator);
      return { operator, accessToken, refreshToken: newRefresh, rootAdminInitialized: false };
    },

    async logout(rawRefreshToken) {
      if (!rawRefreshToken) return null;
      const operatorId = await deps.store.revokeRefreshToken(sha256Hex(rawRefreshToken));
      if (!operatorId) return null;

      const operator = await deps.store.findOperatorById(operatorId);
      // Hard-deleted mid-session: the token is gone, there is no one to report.
      if (!operator) return null;

      deps.audit.authenticationLogout({
        operatorId: operator.id,
        role: operator.role,
        workspaceId: deps.config.workspaceId,
      });

      // Cosmetic and best-effort; a failed presence write must not fail logout.
      await deps.store.setPresenceOffline(operator.id).catch((error: unknown) => {
        console.error(
          "[auth-gateway] could not mark offline:",
          error instanceof Error ? error.message : error,
        );
      });

      return { operatorId: operator.id };
    },
  };
}
