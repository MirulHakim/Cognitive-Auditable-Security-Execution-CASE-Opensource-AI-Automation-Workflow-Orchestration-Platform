import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activateTemplate,
  approveTemplate,
  createTemplate,
  deactivateTemplate,
  errorMessage,
  listInstances,
  listMembers,
  listTemplates,
  updateTemplate,
} from "../../api/client";
import type { Member, Template, WorkflowInstance } from "../../api/types";
import { timeAgo } from "../../lib/format";
import type { WorkflowItem } from "./components/list/WorkflowTable";

/**
 * Real data + mutations for the workflow screens (Dashboard and Workflows).
 * The server enforces permissions; this hook only surfaces its error messages.
 */
export function useWorkflowData() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listTemplates(),
      listInstances().catch(() => []),
      listMembers().catch(() => []),
    ])
      .then(([nextTemplates, nextInstances, nextMembers]) => {
        if (cancelled) return;
        setTemplates(nextTemplates);
        setInstances(nextInstances);
        setMembers(nextMembers);
        setError(null);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /** Latest run per template, used for the "Last run" column. */
  const lastRunByTemplate = useMemo(() => {
    const map = new Map<string, WorkflowInstance>();
    for (const instance of instances) {
      const current = map.get(instance.templateId);
      if (!current || new Date(instance.updatedAt) > new Date(current.updatedAt)) {
        map.set(instance.templateId, instance);
      }
    }
    return map;
  }, [instances]);

  const rows = useMemo<WorkflowItem[]>(
    () =>
      templates.map((template) => {
        const lastRun = lastRunByTemplate.get(template.templateId);
        return {
          id: template.templateId,
          name: template.name,
          description: `${template.steps.length} step${
            template.steps.length === 1 ? "" : "s"
          } · ${template.origin === "AI_DRAFTED" ? "AI-drafted" : "Manual"} · ${
            template.reviewStatus
          }`,
          status: template.isActive ? "active" : "inactive",
          lastRun: lastRun ? timeAgo(lastRun.updatedAt) : "Never",
          createdAt: template.createdAt,
          triggerType: template.origin === "AI_DRAFTED" ? "AI draft" : "Manual",
        };
      }),
    [templates, lastRunByTemplate],
  );

  const run = useCallback(
    async (task: () => Promise<unknown>, message: string) => {
      setError(null);
      setNotice(null);
      try {
        await task();
        setNotice(message);
        refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [refresh],
  );

  const toggleActive = useCallback(
    (template: Template) =>
      run(
        () =>
          template.isActive
            ? deactivateTemplate(template.templateId)
            : template.reviewStatus === "APPROVED"
              ? activateTemplate(template.templateId)
              : approveTemplate(template.templateId),
        template.isActive
          ? `${template.name} deactivated — its history is kept.`
          : `${template.name} is active.`,
      ),
    [run],
  );

  const rename = useCallback(
    (template: Template, name: string) =>
      run(
        () => updateTemplate(template.templateId, { name }),
        `Renamed to “${name}”.`,
      ),
    [run],
  );

  const duplicate = useCallback(
    (template: Template) =>
      run(
        () =>
          createTemplate({
            name: `${template.name} (Copy)`,
            steps: template.steps.map((step) => ({ ...step })),
          }),
        `Copied ${template.name} — the copy starts as a pending draft.`,
      ),
    [run],
  );

  const remove = useCallback(
    (template: Template) =>
      run(
        () => deactivateTemplate(template.templateId),
        `${template.name} deactivated. Nothing was deleted.`,
      ),
    [run],
  );

  const exportJson = useCallback((template: Template) => {
    const data =
      "data:application/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(template, null, 2));
    const anchor = document.createElement("a");
    anchor.href = data;
    anchor.download = `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const byId = useCallback(
    (id: string) => templates.find((template) => template.templateId === id),
    [templates],
  );

  return {
    templates,
    instances,
    members,
    rows,
    loading,
    error,
    notice,
    setNotice,
    setError,
    refresh,
    toggleActive,
    rename,
    duplicate,
    remove,
    exportJson,
    byId,
  };
}
