import { isExecutionMode } from "@artemis/protocol";
import { useEffect, useState } from "react";
import type { AppLocale, HookCatalog } from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { Button } from "@artemis/ui/actions";
import { hookText } from "../../shared/i18n/hooks-copy.js";
import { uiText } from "../../shared/i18n/ui-text.js";

export function HookTaskNotice({
  locale,
  threadId,
  projectId,
  mode,
  onReview,
}: {
  locale: AppLocale;
  threadId?: string;
  projectId?: string;
  mode: string;
  onReview(trigger: HTMLButtonElement): void;
}) {
  const [catalog, setCatalog] = useState<HookCatalog>();
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      window.artemis
        .listHooks({
          ...(threadId ? { threadId } : projectId ? { projectId } : {}),
        })
        .then((value) => {
          if (alive) setCatalog(value);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [threadId, projectId, mode]);
  const pending =
    catalog?.hooks.filter(
      (h) =>
        h.status === "pending" &&
        (threadId || projectId || h.source !== "project"),
    ).length ?? 0;
  const latest = threadId ? catalog?.records.at(-1) : undefined;
  if (
    !isExecutionMode(mode) ||
    (!pending && latest?.status !== "failed" && latest?.status !== "running")
  )
    return null;
  return (
    <div className="hook-task-notice" role="status">
      <ArtemisIcon name="hooks" />
      <span>
        {pending
          ? uiText(locale, "Hooks.pendingNotice", { count: pending })
          : `${latest!.event} · ${hookText(locale, `Hooks.${latest!.status}`)}`}
      </span>
      <Button
        className="hook-task-review"
        variant="quiet"
        size="compact"
        onClick={(event) => onReview(event.currentTarget)}
      >
        {uiText(locale, "Hooks.review")}
      </Button>
    </div>
  );
}
