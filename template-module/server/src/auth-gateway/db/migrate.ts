import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "../../db/pool.js";

/**
 * The gateway owns its own migration ledger so the existing workflow server can
 * keep using `schema_migrations` untouched. Both runners may point at the same
 * database; they apply disjoint sets of files.
 *
 * A session advisory lock makes simultaneous gateway boots safe: only one
 * process applies the files, the others wait and then see them as applied.
 */

const MIGRATION_LOCK_KEY = 728_931_403;

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "migrations"),
    // Running from dist/: tsc does not copy .sql files, so fall back to source.
    join(here, "..", "..", "..", "src", "auth-gateway", "db", "migrations"),
  ];
  for (const candidate of candidates) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error("[auth-gateway] migrations directory not found.");
}

export async function migrateAuthGateway(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const ran: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_gateway_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (
        await client.query<{ filename: string }>(
          "SELECT filename FROM auth_gateway_migrations",
        )
      ).rows.map((row) => row.filename),
    );

    const directory = migrationsDir();
    const files = readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(directory, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO auth_gateway_migrations (filename) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        ran.push(file);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    return ran;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(
      () => undefined,
    );
    client.release();
  }
}

/** Boot-time check: the audit chain table belongs to the existing server. */
export async function assertAuditTable(pool: Pool): Promise<void> {
  const result = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.audit_events') IS NOT NULL AS exists",
  );
  if (!result.rows[0]?.exists) {
    throw new Error(
      "[auth-gateway] audit_events is missing. Start the workflow API once (or run `npm run migrate` in server/) before the gateway.",
    );
  }
}
