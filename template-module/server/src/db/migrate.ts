import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "./pool.js";

/**
 * Minimal forward-only migration runner: each *.sql file runs once inside its
 * own transaction and is recorded in schema_migrations.
 *
 * Callers that want progress output (the CLI) pass `log`. The server's boot-time
 * AUTO_MIGRATE path stays quiet and only reports the summary it printed before.
 */

const MIGRATION_LOCK_KEY = 728_931_401;

/** Core tables the workflow API cannot start without. */
export const CORE_TABLES = [
  "operators",
  "workflow_templates",
  "template_reviews",
  "workflow_instances",
  "step_runs",
  "audit_events",
] as const;

export interface MigrateOptions {
  log?: (message: string) => void;
}

/**
 * Locate the .sql files.
 *
 * `tsx` runs from src/, but `tsc` does not copy .sql into dist/, so the compiled
 * entrypoint (npm start) has to fall back to the TypeScript tree. Without this
 * the runner would throw ENOENT — or, worse, find nothing and report success.
 */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "migrations"),
    join(here, "..", "..", "src", "db", "migrations"),
  ];
  for (const candidate of candidates) {
    try {
      if (readdirSync(candidate).some((file) => file.endsWith(".sql"))) return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `[migrate] no .sql files found. Looked in: ${candidates.join(", ")}`,
  );
}

/** PostgreSQL errors carry the useful fields in code/detail/hint, not `message`. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const { code, detail, hint } = error as { code?: string; detail?: string; hint?: string };
    const parts = [error.message];
    if (code) parts.push(`(code ${code})`);
    if (detail) parts.push(`detail: ${detail}`);
    if (hint) parts.push(`hint: ${hint}`);
    return parts.join(" ");
  }
  return String(error);
}

export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<string[]> {
  const log = options.log ?? (() => undefined);

  // Resolve the files before connecting so a packaging mistake fails loudly
  // instead of looking like an empty migration set.
  const directory = migrationsDir();
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`[migrate] ${directory} contains no .sql files.`);
  }
  log(`[migrate] ${files.length} migration file(s) found in ${directory}`);

  const client = await pool.connect();
  const ran: string[] = [];
  try {
    // Serialise concurrent boots; only one process applies a given file.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (
        await client.query<{ filename: string }>(
          "SELECT filename FROM schema_migrations",
        )
      ).rows.map((row) => row.filename),
    );
    log(`[migrate] ${applied.size} already recorded in schema_migrations`);

    for (const file of files) {
      if (applied.has(file)) {
        log(`[migrate] skip ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(directory, file), "utf8");
      log(`[migrate] applying ${file} ...`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        ran.push(file);
        log(`[migrate] applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`[migrate] ${file} failed and was rolled back — ${describeError(error)}`);
      }
    }

    if (ran.length === 0) log("[migrate] no pending migrations");
    return ran;
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
}

/** Post-condition check for the CLI: report which core tables are still absent. */
export async function missingCoreTables(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ name: string; present: boolean }>(
    `SELECT t.name, to_regclass('public.' || t.name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS t(name)`,
    [CORE_TABLES],
  );
  return result.rows.filter((row) => !row.present).map((row) => row.name);
}
