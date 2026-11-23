import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../../db/pool.js";
import { assertAuditTable, migrateAuthGateway } from "./migrate.js";

/**
 * CLI for `npm run auth:migrate`.
 *
 * Migrations need only the database URL. Requiring Google/JWT configuration
 * here would make CI and first-time setup needlessly fail.
 */

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnv({ path: join(serverRoot, ".env") });
loadEnv();

const AUTH_TABLES = ["auth_accounts", "auth_invitations", "auth_refresh_tokens"];

/** host:port/database — never the credentials. */
function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "(unparseable AUTH_DATABASE_URL)";
  }
}

async function verifyAuthTables(pool: ReturnType<typeof createPool>): Promise<void> {
  const result = await pool.query<{ name: string; present: boolean }>(
    `SELECT t.name, to_regclass('public.' || t.name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS t(name)`,
    [AUTH_TABLES],
  );
  const missing = result.rows.filter((row) => !row.present).map((row) => row.name);
  if (missing.length > 0) {
    throw new Error(`auth tables still missing after migration: ${missing.join(", ")}`);
  }
  console.log(`[auth-gateway] verified tables: ${AUTH_TABLES.join(", ")}`);
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.AUTH_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/template_module";

  // The gateway must share the workflow API's database: its foreign keys point
  // at operators(operator_id). Warn loudly when the two differ.
  const workflowUrl = process.env.DATABASE_URL?.trim();
  if (workflowUrl && workflowUrl !== databaseUrl) {
    const sameTarget = describeTarget(workflowUrl) === describeTarget(databaseUrl);
    if (!sameTarget) {
      console.warn(
        `[auth-gateway] DATABASE_URL (${describeTarget(workflowUrl)}) and ` +
          `AUTH_DATABASE_URL (${describeTarget(databaseUrl)}) point at different databases. ` +
          "The gateway needs the one that already contains `operators`.",
      );
    }
  }

  console.log(`[auth-gateway] target: ${describeTarget(databaseUrl)}`);
  const pool = createPool(databaseUrl);
  pool.on("error", (error) => {
    console.error("[auth-gateway][postgres] idle client error:", error.message);
  });

  try {
    const applied = await migrateAuthGateway(pool);
    await assertAuditTable(pool);
    await verifyAuthTables(pool);
    console.log(
      applied.length > 0
        ? `[auth-gateway] applied: ${applied.join(", ")}`
        : "[auth-gateway] no pending migrations",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const { code, detail, hint } = (error ?? {}) as {
    code?: string;
    detail?: string;
    hint?: string;
  };
  const message = error instanceof Error ? error.message : String(error);
  console.error("[auth-gateway][migrate] failed:", message);
  if (code) console.error(`[auth-gateway][migrate] postgres code: ${code}`);
  if (detail) console.error(`[auth-gateway][migrate] detail: ${detail}`);
  if (hint) console.error(`[auth-gateway][migrate] hint: ${hint}`);
  process.exit(1);
});
