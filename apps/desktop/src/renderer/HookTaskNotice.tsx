import { useEffect, useState } from "react";
import type { AppLocale, HookCatalog } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { hookText } from "../shared/hooks-copy.js";
import { uiText } from "../shared/ui-text.js";

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
    catalog?.hooks.filter((h) => h.status === "pending").length ?? 0;
  const latest = threadId ? catalog?.records.at(-1) : undefined;
  if (!pending && !latest) return null;
  return (
    <div className="sandbox-notice" role="status">
      <span>
        {pending
          ? mode === "execute" && !catalog?.remote
            ? uiText(locale, "Hooks.pendingNotice", { count: pending })
            : uiText(locale, "Hooks.skipped")
          : `${latest!.event} · ${hookText(locale, `Hooks.${latest!.status}`)}`}
      </span>
      <Button onClick={(event) => onReview(event.currentTarget)}>
        {uiText(locale, "Hooks.review")}
      </Button>
    </div>
  );
}
