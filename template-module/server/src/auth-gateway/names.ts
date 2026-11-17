/**
 * Human-readable names derived from an email address.
 *
 * The legacy whitelist route, invitation acceptance and the unified directory
 * all use the same transformation so a person's name does not change when they
 * move from "Pending" to a real account.
 */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
