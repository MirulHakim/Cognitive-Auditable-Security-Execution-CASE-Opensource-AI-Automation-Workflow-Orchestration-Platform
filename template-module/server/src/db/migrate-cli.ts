import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./pool.js";
import { migrate, missingCoreTables } from "./migrate.js";

/**
 * CLI for `npm run migrate`.
 *
 * Two things used to make this fail silently:
 *   1. package.json pointed at src/db/migrate.ts, which only *exports* a
 *      function — nothing connected or ran, so the process exited 0.
 *   2. Nothing loaded .env, so even with a CLI the URL would have been missing.
 * Both are fixed here; every failure now exits non-zero with a message.
 */

// npm -w runs in the workspace, but a direct `tsx /abs/path` may not. Load the
// server package's .env first (dotenv never overrides an already-set variable),
// then fall back to the current working directory.
const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv({ path: join(serverRoot, ".env") });
loadEnv();

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/template_module";

/** host:port/database — never the credentials. */
function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn(
      `[migrate] DATABASE_URL is not set in ${join(serverRoot, ".env")} or the environment; ` +
        "falling back to the local development default.",
    );
  }
  const connectionString = databaseUrl || DEFAULT_DATABASE_URL;
  console.log(`[migrate] target: ${describeTarget(connectionString)}`);

  const pool = createPool(connectionString);
  pool.on("error", (error) => {
    console.error("[migrate][postgres] idle client error:", error.message);
  });

  try {
    const applied = await migrate(pool, { log: (line) => console.log(line) });

    const missing = await missingCoreTables(pool);
    if (missing.length > 0) {
      throw new Error(
        `migration completed but these core tables are still missing: ${missing.join(", ")}`,
      );
    }

    const operators = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM operators",
    );

    console.log(
      applied.length > 0
        ? `[migrate] success — applied ${applied.length} migration(s): ${applied.join(", ")}`
        : "[migrate] success — schema already up to date",
    );
    console.log(
      `[migrate] verified core tables (${missing.length === 0 ? "all present" : "missing: " + missing.join(", ")}); ` +
        `operators rows: ${operators.rows[0]?.count ?? "?"}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[migrate] FAILED:", message);
  console.error(
    "[migrate] check that PostgreSQL is running, DATABASE_URL in server/.env is correct, " +
      "and the database exists. Nothing was committed if a file failed.",
  );
  process.exit(1);
});
