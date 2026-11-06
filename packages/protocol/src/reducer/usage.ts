import type { AgentEvent } from "../schema.js";
import { type ThreadViewState, type ContextCompactionState } from "./state.js";
import { appendOnce, type ReductionIndex } from "./timeline.js";

export function runningContextCompaction(
  state: ThreadViewState,
): ContextCompactionState | undefined {
  for (let index = state.order.length - 1; index >= 0; index -= 1) {
    const entry = state.order[index]!;
    if (!entry.startsWith("compaction:")) continue;
    const compaction =
      state.contextCompactions[entry.slice("compaction:".length)];
    if (compaction?.status === "running") return compaction;
  }
  return undefined;
}

export function applyUsagePayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "context.usage": {
      const wasCompacting = state.contextUsage?.compacting === true;
      const preserveEstimate =
        payload.tokens === null &&
        state.contextUsage?.estimated === true &&
        state.contextUsage.tokens !== null;
      const estimated = preserveEstimate ? true : payload.estimated;
      const previous = preserveEstimate ? state.contextUsage : undefined;
      const breakdown = preserveEstimate
        ? previous?.breakdown
        : (payload.breakdown ?? previous?.breakdown);
      state.contextUsage = {
        tokens: preserveEstimate ? previous!.tokens : payload.tokens,
        contextWindow: payload.contextWindow,
        compacting: payload.compacting,
        ...(estimated === undefined ? {} : { estimated }),
        ...((payload.source ?? previous?.source) === undefined
          ? {}
          : { source: payload.source ?? previous?.source }),
        ...((payload.providerInputTokens ?? previous?.providerInputTokens) ===
        undefined
          ? {}
          : {
              providerInputTokens:
                payload.providerInputTokens ?? previous?.providerInputTokens,
            }),
        ...(breakdown === undefined ? {} : { breakdown }),
        ...((payload.footprint ?? previous?.footprint) === undefined
          ? {}
          : { footprint: payload.footprint ?? previous?.footprint }),
      };
      if (payload.compacting && !wasCompacting) {
        state.contextCompactions[event.eventId] = {
          id: event.eventId,
          status: "running",
        };
        appendOnce(state.order, orderedItems, `compaction:${event.eventId}`);
      } else if (!payload.compacting && wasCompacting) {
        const runningCompaction = runningContextCompaction(state);
        if (runningCompaction) {
          state.contextCompactions[runningCompaction.id] = {
            ...runningCompaction,
            status: payload.compactionResult?.status ?? "completed",
            ...(payload.compactionResult?.error
              ? { error: payload.compactionResult.error }
              : {}),
            completedAt: event.timestamp,
          };
        }
      }
      return;
    }
    case "assistant.usage": {
      const cachePolicies = { ...state.assistantUsage.cachePolicies };
      if (payload.cachePolicy) cachePolicies[payload.cachePolicy] += 1;
      state.assistantUsage = {
        inputTokens: state.assistantUsage.inputTokens + payload.inputTokens,
        outputTokens: state.assistantUsage.outputTokens + payload.outputTokens,
        cacheReadTokens:
          state.assistantUsage.cacheReadTokens + payload.cacheReadTokens,
        cacheWriteTokens:
          state.assistantUsage.cacheWriteTokens + payload.cacheWriteTokens,
        totalTokens: state.assistantUsage.totalTokens + payload.totalTokens,
        usageEvents: state.assistantUsage.usageEvents + 1,
        cacheReadReportedEvents:
          state.assistantUsage.cacheReadReportedEvents +
          (payload.cacheReadReported === true ? 1 : 0),
        cacheWriteReportedEvents:
          state.assistantUsage.cacheWriteReportedEvents +
          (payload.cacheWriteReported === true ? 1 : 0),
        cachePolicies,
      };
      return;
    }
  }
}
