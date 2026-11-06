import { modelFormState, modelKey } from "../settings-values.js";

import { useEffect, type RefObject } from "react";

import type { SettingsSnapshot } from "../../../shared/api.js";

interface UseSettingsSubscriptionsContext {
  readonly modelEditTriggerRef: import("react").RefObject<HTMLButtonElement | null | null>;
  readonly editingModelKey: string | undefined;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly setSelectedProviderId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setGlobalAgentsContent: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setAgentConcurrencyLimit: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setSelectedModel: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setContextWindow: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
}
export function useSettingsSubscriptions(
  context: UseSettingsSubscriptionsContext,
) {
  const {
    modelEditTriggerRef,
    editingModelKey,
    setMessage,
    setSettings,
    setSelectedProviderId,
    setGlobalAgentsContent,
    setAgentConcurrencyLimit,
    setSelectedModel,
    setContextWindow,
  } = context;
  useEffect(() => {
    if (!editingModelKey) modelEditTriggerRef.current?.focus();
  }, [editingModelKey]);

  useEffect(() => {
    let mounted = true;
    void window.artemis
      .getSettings()
      .then((snapshot) => {
        if (!mounted) return;
        setSettings(snapshot);
        setSelectedProviderId(
          (current) =>
            current ||
            snapshot.selection?.providerId ||
            snapshot.models[0]?.providerId ||
            snapshot.providers[0]?.id ||
            "",
        );
        setGlobalAgentsContent(snapshot.globalAgents.content);
        setAgentConcurrencyLimit(
          String(
            snapshot.agentConcurrency.preference.mode === "manual"
              ? snapshot.agentConcurrency.preference.limit
              : snapshot.agentConcurrency.configuredLimit,
          ),
        );
        const modelState = modelFormState(snapshot);
        setSelectedModel(modelState.selectedModel);
        setContextWindow(modelState.contextWindow);
      })
      .catch(
        (error) =>
          mounted &&
          setMessage(error instanceof Error ? error.message : String(error)),
      );
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(
    () =>
      window.artemis.onUpdateStatus((update) => {
        setSettings((current) => (current ? { ...current, update } : current));
      }),
    [],
  );
  return {};
}
