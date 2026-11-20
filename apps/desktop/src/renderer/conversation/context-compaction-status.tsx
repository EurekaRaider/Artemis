import { TurnStatus } from "@artemis/ui/patterns";
import {
  isShortSessionCompactionError,
  type ThreadViewState,
} from "@artemis/protocol";
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
  const tooShort =
    compaction.status === "failed" &&
    isShortSessionCompactionError(compaction.error);
  const state =
    tooShort || compaction.status === "cancelled" ? "idle" : compaction.status;
  const label = tooShort
    ? t.contextCompactionTooShort
    : {
        running: t.contextCompacting,
        completed: t.contextCompacted,
        failed: t.contextCompactionFailed,
        cancelled: t.contextCompactionCancelled,
      }[compaction.status];
  return (
    <TurnStatus
      className={`turn-status compaction-status ${state}`}
      label={label}
      state={state}
      statusLabel={tooShort ? label : (compaction.error ?? label)}
    />
  );
}
