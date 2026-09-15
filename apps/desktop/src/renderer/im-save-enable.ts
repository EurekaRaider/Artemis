import type { ImSettings, ImStatus } from "@artemis/protocol";

export type ImSaveEnableOutcome =
  | { phase: "enabled"; status: ImStatus }
  | { phase: "save-failed"; error: string }
  | { phase: "saved-enable-failed"; error: string; status: ImStatus };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * PR-S2 combined entry: persist authorizations first; only after that
 * succeeds, enable the connection. Saving an already-enabled service keeps
 * it enabled in one phase. Each phase resends the same settings payload,
 * so retrying cannot duplicate grants.
 */
export async function imSaveAndEnable(
  save: (settings: ImSettings) => Promise<ImStatus>,
  draft: ImSettings,
  current: ImSettings,
): Promise<ImSaveEnableOutcome> {
  let saved: ImStatus;
  try {
    saved = await save({ ...draft, enabled: current.enabled });
  } catch (error) {
    return { phase: "save-failed", error: messageOf(error) };
  }
  if (saved.settings.enabled) return { phase: "enabled", status: saved };
  try {
    const enabled = await save({ ...saved.settings, enabled: true });
    return { phase: "enabled", status: enabled };
  } catch (error) {
    return {
      phase: "saved-enable-failed",
      error: messageOf(error),
      status: saved,
    };
  }
}

/** Retry only the enable phase against the persisted authorizations. */
export async function imRetryEnable(
  save: (settings: ImSettings) => Promise<ImStatus>,
  current: ImSettings,
): Promise<ImStatus> {
  return save({ ...current, enabled: true });
}
