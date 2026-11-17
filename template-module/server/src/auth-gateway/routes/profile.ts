import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, GatewayError } from "../errors.js";
import type { AuthStore, ProfileRecord, ThemePreference } from "../store.js";

/**
 * Self-service profile route, owned entirely by the gateway.
 *
 * The legacy API has no profile-write endpoint, and the profile page needs one
 * that works for every member. Display name and contact number live on the
 * `operators` row (the identity table both sides already share); the theme
 * choice lives on `auth_accounts` because it is account-scoped and should
 * follow the person across devices.
 *
 * The operator id is ALWAYS taken from the verified session. No request body
 * field can address another member, and `.strict()` rejects attempts to try.
 */

const CONTACT_PATTERN = /^[+()0-9 .-]{3,40}$/;

const UpdateProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    contactNumber: z.union([z.string().trim().max(40), z.null()]).optional(),
  })
  .strict()
  .refine(
    (value) => value.displayName !== undefined || value.contactNumber !== undefined,
    { message: "Nothing to update." },
  );

const ThemeSchema = z
  .object({ theme: z.enum(["light", "dark", "system"]) })
  .strict();

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new GatewayError(401, "UNAUTHENTICATED", "Authentication required.");
  }
  return req.auth;
}

/**
 * Empty input clears the number. Anything present must look like a phone
 * number, so a stray note cannot be stored in a contact field.
 */
function normalizeContact(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!CONTACT_PATTERN.test(trimmed)) {
    throw new GatewayError(
      400,
      "INVALID_CONTACT_NUMBER",
      "Enter a valid contact number (digits, spaces and + ( ) . - only).",
    );
  }
  return trimmed;
}

function publicProfile(profile: ProfileRecord) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    role: profile.role,
    contactNumber: profile.contactNumber,
    themePreference: profile.themePreference,
  };
}

export function createProfileRouter(deps: { store: AuthStore }): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const profile = await deps.store.findProfile(auth.operator.id);
      if (!profile) {
        throw new GatewayError(404, "OPERATOR_NOT_FOUND", "Member not found.");
      }
      res.setHeader("cache-control", "private, no-store");
      res.json({ profile: publicProfile(profile) });
    }),
  );

  router.patch(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const parsed = UpdateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new GatewayError(
          400,
          "INVALID_PROFILE",
          "Enter a display name of 2–120 characters and a valid contact number.",
          { fields: parsed.error.issues.map((issue) => issue.path.join(".")) },
        );
      }

      const contactNumber = normalizeContact(parsed.data.contactNumber);
      const updated = await deps.store.updateProfile(auth.operator.id, {
        ...(parsed.data.displayName !== undefined
          ? { displayName: parsed.data.displayName }
          : {}),
        ...(contactNumber !== undefined ? { contactNumber } : {}),
      });
      if (!updated) {
        throw new GatewayError(404, "OPERATOR_NOT_FOUND", "Member not found.");
      }

      res.setHeader("cache-control", "private, no-store");
      res.json({ profile: publicProfile(updated) });
    }),
  );

  // Separate from the profile form: the theme switch fires on every click, and
  // this response is deliberately tiny.
  router.patch(
    "/preferences",
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const parsed = ThemeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new GatewayError(
          400,
          "INVALID_THEME",
          "Theme must be light, dark or system.",
        );
      }

      const theme: ThemePreference = parsed.data.theme;
      const persisted = await deps.store.setThemePreference(
        auth.operator.id,
        theme,
      );

      res.setHeader("cache-control", "private, no-store");
      res.json({
        themePreference: theme,
        // A member who has not linked Google yet has no auth_accounts row to
        // write to; the browser-local preference still applies.
        persisted,
      });
    }),
  );

  return router;
}
