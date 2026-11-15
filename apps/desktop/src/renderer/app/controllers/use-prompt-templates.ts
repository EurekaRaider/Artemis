import { useEffect, useState } from "react";
import type { PromptTemplateInfo } from "../../../shared/api/prompt-templates.js";

export function usePromptTemplates(
  projectId: string | undefined,
  threadId: string | undefined,
  open: boolean,
) {
  const [result, setResult] = useState<{
    key: string;
    templates: PromptTemplateInfo[];
    error?: string;
  }>({ key: "", templates: [] });
  const key = `${projectId ?? ""}\0${threadId ?? ""}`;
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void window.artemis.listPromptTemplates(projectId, threadId).then(
      (templates) => {
        if (!disposed) setResult({ key, templates });
      },
      (error: unknown) => {
        if (!disposed) setResult({ key, templates: [], error: String(error) });
      },
    );
    return () => {
      disposed = true;
    };
  }, [projectId, threadId, open, key]);
  return result.key === key ? result : { templates: [], error: undefined };
}
