import { type AutomationViewState } from "@artemis/protocol";
import { useMemo } from "react";

interface UseAutomationListContext {
  readonly projectFilter: string;
  readonly statusFilter: "all" | "enabled" | "paused";
  readonly state: AutomationViewState;
  readonly selectedAutomationId: string | undefined;
}
export function useAutomationList(context: UseAutomationListContext) {
  const { projectFilter, statusFilter, state, selectedAutomationId } = context;
  const automations = useMemo(
    () =>
      Object.values(state.automations)
        .filter(
          (automation) =>
            (!projectFilter || automation.projectId === projectFilter) &&
            (statusFilter === "all" ||
              automation.enabled === (statusFilter === "enabled")),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [projectFilter, statusFilter, state.automations],
  );

  const selectedAutomation =
    automations.find((item) => item.id === selectedAutomationId) ??
    automations[0];
  return { automations, selectedAutomation };
}
