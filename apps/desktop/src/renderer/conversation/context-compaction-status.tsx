import { TurnStatus } from "@artemis/ui/patterns";
import { useEffect, useState } from "react";

import { type ThreadViewState } from "@artemis/protocol";
import { appCopy } from "../app/app-copy.js";

import { type Locale } from "../app/app-types.js";
export function ContextCompactionStatus({
  compaction,
  locale,
}: {
  compaction: ThreadViewState["contextCompactions"][string];
  locale: Locale;
}) {
  const t = appCopy(locale);
  const completionDeadline = compaction.completedAt
    ? Date.parse(compaction.completedAt) +
      COMPACTION_COMPLETION_NOTICE_MILLISECONDS
    : 0;
  const [visible, setVisible] = useState(
    () => compaction.status !== "completed" || completionDeadline > Date.now(),
  );

  useEffect(() => {
    if (compaction.status !== "completed") {
      setVisible(true);
      return;
    }
    const remainingMilliseconds = completionDeadline - Date.now();
    if (remainingMilliseconds <= 0) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(
      () => setVisible(false),
      remainingMilliseconds,
    );
    return () => window.clearTimeout(timer);
  }, [compaction.id, compaction.status, completionDeadline]);

  if (!visible) return null;
  const label =
    compaction.status === "running"
      ? t.contextCompacting
      : compaction.status === "failed"
        ? t.contextCompactionFailed
        : compaction.status === "cancelled"
          ? t.contextCompactionCancelled
          : t.contextCompacted;
  return (
    <TurnStatus
      className={`turn-status compaction-status ${compaction.status}`}
      label={label}
      state={compaction.status === "cancelled" ? "idle" : compaction.status}
      statusLabel={compaction.error ?? label}
    />
  );
}

export const COMPACTION_COMPLETION_NOTICE_MILLISECONDS = 5_000;
