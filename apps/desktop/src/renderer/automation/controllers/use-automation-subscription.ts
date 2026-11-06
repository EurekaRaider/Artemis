import {
  reduceAutomationEvent,
  type AutomationViewState,
} from "@artemis/protocol";
import { useEffect } from "react";

interface UseAutomationSubscriptionContext {
  readonly setState: import("react").Dispatch<
    import("react").SetStateAction<AutomationViewState>
  >;
  readonly setLoading: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
}
export function useAutomationSubscription(
  context: UseAutomationSubscriptionContext,
) {
  const { setState, setLoading, setMessage } = context;
  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.artemis.onAutomationEvent((event) => {
      if (!mounted) return;
      setState((current) => reduceAutomationEvent(current, event));
    });
    void window.artemis
      .listAutomations()
      .then(async (automations) => {
        const histories = await Promise.all(
          automations.map((automation) =>
            window.artemis.listAutomationRuns(automation.id, 10),
          ),
        );
        if (!mounted) return;
        setState((current) => ({
          automations: {
            ...Object.fromEntries(
              automations.map((automation) => [automation.id, automation]),
            ),
            ...current.automations,
          },
          runs: {
            ...current.runs,
            ...Object.fromEntries(histories.flat().map((run) => [run.id, run])),
          },
          seenEventIds: current.seenEventIds,
        }));
      })
      .catch((error) => mounted && setMessage(String(error)))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return {};
}
