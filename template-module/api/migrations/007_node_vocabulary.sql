-- 007_node_vocabulary.sql — the editor's node catalogue as executable steps.
--
-- The first four steps were the manual human-review flow. The editor now also
-- offers the node types that already existed on the develop dashboard (triggers,
-- LLM reasoner, document generator, folder/database readers, connectors), so the
-- execution-history constraint has to accept them.

ALTER TABLE step_runs DROP CONSTRAINT IF EXISTS step_runs_step_type_check;
ALTER TABLE step_runs ADD CONSTRAINT step_runs_step_type_check
  CHECK (step_type IN (
    'review',
    'validation',
    'approval',
    'intake',
    'document',
    'notification',
    'trigger_webhook',
    'trigger_cron',
    'trigger_email',
    'trigger_telegram',
    'llm_agent',
    'agent_react',
    'logic_condition',
    'http_request',
    'document_reader',
    'db_query',
    'gmail',
    'telegram'
  ));

-- Step configuration (model, folder, query, mapping …) is stored inside the
-- steps JSONB snapshot, so no column is needed. Keep the array shape enforced.
ALTER TABLE workflow_templates DROP CONSTRAINT IF EXISTS steps_is_array;
ALTER TABLE workflow_templates ADD CONSTRAINT steps_is_array CHECK (jsonb_typeof(steps) = 'array');

ALTER TABLE workflow_instances DROP CONSTRAINT IF EXISTS instance_steps_is_array;
ALTER TABLE workflow_instances ADD CONSTRAINT instance_steps_is_array
  CHECK (jsonb_typeof(steps) = 'array');
