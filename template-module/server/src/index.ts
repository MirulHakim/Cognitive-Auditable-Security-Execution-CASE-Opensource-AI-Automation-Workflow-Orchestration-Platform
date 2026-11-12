import { PostgresAuditLog } from "./audit/auditLog.js";
import { PostgresOperatorDirectory } from "./auth/operators.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { SimulatedNotificationPort } from "./execution/notifier.js";
import { HtmlFileDocumentGenerator } from "./execution/documents.js";
import { PostgresExecutionRepository } from "./repo/pgExecutionRepo.js";
import { PostgresTemplateRepository } from "./repo/pgRepo.js";
import {
  AiGenerationError,
  type TemplateGenerator,
} from "./services/templateService.js";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

async function main(): Promise<void> {
  const pool = createPool(config.databaseUrl);

  pool.on("error", (error) => {
    console.error("[postgres] idle client error:", error.message);
  });

  if (config.autoMigrate) {
    const applied = await migrate(pool);
    if (applied.length > 0) {
      console.log(`[migrations] applied: ${applied.join(", ")}`);
    }
  }

  // LangGraph checkpoint tables (paused workflows survive restarts).
  const checkpointer = PostgresSaver.fromConnString(config.databaseUrl);
  await checkpointer.setup();

  const app = createApp({
    repo: new PostgresTemplateRepository(pool),
    executions: new PostgresExecutionRepository(pool),
    checkpointer,
    notifier: new SimulatedNotificationPort(),
    // No content drafter here: the document step renders the case input
    // deterministically. The AI-drafted body ships with the ai-intent feature.
    documents: new HtmlFileDocumentGenerator(config.documentOutputDir),
    operators: new PostgresOperatorDirectory(pool),
    generator: new UnavailableTemplateGenerator(),
    rules: config.rules,
    corsOrigins: config.corsOrigins,
    documentOutputDir: config.documentOutputDir,
    audit: new PostgresAuditLog(pool),
    // No `files` port: intake and file reading ship with the ai-intent feature,
    // so an upload step is refused with a clear message instead of half-working.
  });

  app.listen(config.port, () => {
    console.log(`Template API listening on http://127.0.0.1:${config.port}`);
    console.log(`  Ollama: ${config.ollama.baseUrl} (${config.ollama.model})`);
  });
}

/**
 * Engine build: natural-language drafting belongs to the ai-intent feature, so
 * this port answers with a 502 saying so rather than pretending to draft.
 */
class UnavailableTemplateGenerator implements TemplateGenerator {
  async generate(): Promise<never> {
    throw new AiGenerationError(
      "AI drafting is not available in this build. Enable the ai-intent module to draft templates from a description.",
    );
  }
}

main().catch((error: unknown) => {
  console.error(
    "[startup] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
