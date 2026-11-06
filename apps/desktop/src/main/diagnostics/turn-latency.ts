import type { TurnLatencyTrace } from "../application/runtime-types.js";
import type { AgentPayload } from "@artemis/protocol";
import {
  parseContextOverflowTokens,
  type TurnLatencySample,
} from "../platform/diagnostic-bundle.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "diagnosticBundleService" | "turnLatencyTraces"
>;
export function createTurnLatency(services: Dependencies) {
  const { turnLatencyTraces } = services;
  function elapsed(
    start: number | undefined,
    end: number | undefined,
  ): number | undefined {
    if (start === undefined || end === undefined) return undefined;
    return Math.round(Math.max(0, end - start) * 10) / 10;
  }

  function finalizeTurnLatency(trace: TurnLatencyTrace): void {
    if (!trace.completedAt || !trace.outcome) return;
    const origin = trace.submittedAt ?? trace.mainReceivedAt;
    const stagesMs: TurnLatencySample["stagesMs"] = {};
    const addStage = (
      name: keyof TurnLatencySample["stagesMs"],
      start: number | undefined,
      end: number | undefined,
    ) => {
      const value = elapsed(start, end);
      if (value !== undefined) stagesMs[name] = value;
    };
    addStage("submitToMain", trace.submittedAt, trace.mainReceivedAt);
    addStage("localPreModel", trace.mainReceivedAt, trace.hostReceivedAt);
    addStage(
      "optionalCapabilities",
      trace.optionalStartedAt,
      trace.optionalReadyAt,
    );
    addStage(
      "workspaceResolve",
      trace.workspaceStartedAt,
      trace.workspaceEndedAt,
    );
    addStage("threadOpen", trace.threadOpenStartedAt, trace.threadOpenEndedAt);
    addStage("memoryRecall", trace.memoryStartedAt, trace.memoryEndedAt);
    addStage("hostDispatch", trace.hostDispatchedAt, trace.hostReceivedAt);
    addStage("queueWait", trace.queuedAt, trace.modelRequestedAt);
    addStage(
      "modelToFirstActivity",
      trace.modelRequestedAt,
      trace.firstActivityAt,
    );
    addStage("modelToFirstText", trace.modelRequestedAt, trace.firstTextAt);
    addStage("mainToRendererPaint", trace.firstTextAt, trace.rendererPaintAt);
    addStage("total", origin, trace.completedAt);
    const sample: TurnLatencySample = {
      timestamp: new Date().toISOString(),
      outcome: trace.outcome,
      coldThread: trace.coldThread,
      ...(trace.providerId && trace.modelId && trace.thinkingLevel
        ? {
            providerId: trace.providerId,
            modelId: trace.modelId,
            thinkingLevel: trace.thinkingLevel,
          }
        : {}),
      mode: trace.mode,
      enabledMcpServers: trace.enabledMcpServers,
      toolCount: trace.toolCount,
      mcpToolCount: trace.mcpToolCount,
      queueDepth: trace.queueDepth,
      eventCount: trace.eventCount,
      ...(trace.contextTokens === undefined
        ? {}
        : { contextTokens: trace.contextTokens }),
      ...(trace.uncachedInputTokens === undefined
        ? {}
        : { uncachedInputTokens: trace.uncachedInputTokens }),
      ...(trace.cacheReadTokens === undefined
        ? {}
        : { cacheReadTokens: trace.cacheReadTokens }),
      ...(trace.cacheWriteTokens === undefined
        ? {}
        : { cacheWriteTokens: trace.cacheWriteTokens }),
      ...(trace.cacheReadReported === undefined
        ? {}
        : { cacheReadReported: trace.cacheReadReported }),
      ...(trace.cacheWriteReported === undefined
        ? {}
        : { cacheWriteReported: trace.cacheWriteReported }),
      ...(trace.cachePolicy === undefined
        ? {}
        : { cachePolicy: trace.cachePolicy }),
      ...(trace.cachePolicyReason === undefined
        ? {}
        : { cachePolicyReason: trace.cachePolicyReason }),
      ...(trace.cacheKeyFingerprint === undefined
        ? {}
        : { cacheKeyFingerprint: trace.cacheKeyFingerprint }),
      ...(trace.systemPromptFingerprint === undefined
        ? {}
        : { systemPromptFingerprint: trace.systemPromptFingerprint }),
      ...(trace.toolSchemaFingerprint === undefined
        ? {}
        : { toolSchemaFingerprint: trace.toolSchemaFingerprint }),
      ...(trace.stablePrefixTokens === undefined
        ? {}
        : { stablePrefixTokens: trace.stablePrefixTokens }),
      ...(trace.cacheKeyRequestsPerMinute === undefined
        ? {}
        : { cacheKeyRequestsPerMinute: trace.cacheKeyRequestsPerMinute }),
      ...(trace.cacheKeyRateWarning === undefined
        ? {}
        : { cacheKeyRateWarning: trace.cacheKeyRateWarning }),
      ...(trace.providerInputTokens === undefined
        ? {}
        : { providerInputTokens: trace.providerInputTokens }),
      ...(trace.currentEstimatedTokens === undefined
        ? {}
        : { currentEstimatedTokens: trace.currentEstimatedTokens }),
      ...(trace.displayedContextTokens === undefined
        ? {}
        : { displayedContextTokens: trace.displayedContextTokens }),
      ...(trace.contextSource === undefined
        ? {}
        : { contextSource: trace.contextSource }),
      ...(trace.providerLimitTokens === undefined
        ? {}
        : { providerLimitTokens: trace.providerLimitTokens }),
      ...(trace.providerRequestedTokens === undefined
        ? {}
        : { providerRequestedTokens: trace.providerRequestedTokens }),
      ...(trace.contextFootprint === undefined
        ? {}
        : { contextFootprint: trace.contextFootprint }),
      stagesMs,
    };
    services.diagnosticBundleService?.recordTurnLatency(sample);
    turnLatencyTraces.delete(trace.turnId);
  }

  function observeTurnPayload(
    turnId: string | undefined,
    payload: AgentPayload,
  ): void {
    if (!turnId) return;
    const trace = turnLatencyTraces.get(turnId);
    if (!trace) return;
    const now = Date.now();
    trace.eventCount += 1;
    if (payload.type === "turn.activity") {
      if (payload.phase === "queued") {
        trace.queuedAt ??= now;
        trace.queueDepth = Math.max(trace.queueDepth, payload.queueDepth ?? 0);
      } else if (payload.phase === "requesting-model") {
        trace.modelRequestedAt ??= now;
        trace.queueDepth = Math.max(trace.queueDepth, payload.queueDepth ?? 0);
        trace.toolCount = payload.toolCount ?? trace.toolCount;
      } else if (payload.phase === "thinking") {
        trace.firstActivityAt ??= now;
      }
    } else if (
      payload.type === "message.part.delta" &&
      payload.partType === "text"
    ) {
      trace.firstActivityAt ??= now;
      trace.firstTextAt ??= now;
    } else if (payload.type === "tool.started") {
      trace.firstActivityAt ??= now;
    } else if (payload.type === "context.usage") {
      if (payload.tokens !== null) {
        trace.contextTokens = payload.tokens;
        trace.currentEstimatedTokens = payload.tokens;
        trace.displayedContextTokens = payload.tokens;
      }
      if (payload.source !== undefined) trace.contextSource = payload.source;
      if (payload.providerInputTokens !== undefined) {
        trace.providerInputTokens = payload.providerInputTokens;
      }
      if (payload.footprint !== undefined) {
        trace.contextFootprint = payload.footprint;
      }
    } else if (payload.type === "assistant.usage") {
      trace.contextTokens ??=
        payload.inputTokens +
        payload.cacheReadTokens +
        payload.cacheWriteTokens;
      trace.uncachedInputTokens =
        (trace.uncachedInputTokens ?? 0) + payload.inputTokens;
      trace.providerInputTokens =
        (trace.providerInputTokens ?? 0) +
        payload.inputTokens +
        payload.cacheReadTokens +
        payload.cacheWriteTokens;
      trace.cacheReadTokens =
        (trace.cacheReadTokens ?? 0) + payload.cacheReadTokens;
      trace.cacheWriteTokens =
        (trace.cacheWriteTokens ?? 0) + payload.cacheWriteTokens;
      if (payload.cacheReadReported !== undefined) {
        trace.cacheReadReported =
          trace.cacheReadReported === true || payload.cacheReadReported;
      }
      if (payload.cacheWriteReported !== undefined) {
        trace.cacheWriteReported =
          trace.cacheWriteReported === true || payload.cacheWriteReported;
      }
      if (payload.cachePolicy !== undefined) {
        trace.cachePolicy = payload.cachePolicy;
      }
      if (payload.cachePolicyReason !== undefined) {
        trace.cachePolicyReason = payload.cachePolicyReason;
      }
      if (payload.cacheKeyFingerprint !== undefined) {
        trace.cacheKeyFingerprint = payload.cacheKeyFingerprint;
      }
      if (payload.systemPromptFingerprint !== undefined) {
        trace.systemPromptFingerprint = payload.systemPromptFingerprint;
      }
      if (payload.toolSchemaFingerprint !== undefined) {
        trace.toolSchemaFingerprint = payload.toolSchemaFingerprint;
      }
      if (payload.stablePrefixTokens !== undefined) {
        trace.stablePrefixTokens = payload.stablePrefixTokens;
      }
      trace.cacheKeyRequestsPerMinute = Math.max(
        trace.cacheKeyRequestsPerMinute ?? 0,
        payload.cacheKeyRequestsPerMinute ?? 0,
      );
      const firstCacheKeyRateWarning =
        trace.cacheKeyRateWarning !== true &&
        payload.cacheKeyRateWarning === true;
      trace.cacheKeyRateWarning =
        trace.cacheKeyRateWarning === true ||
        payload.cacheKeyRateWarning === true;
      if (firstCacheKeyRateWarning) {
        services.diagnosticBundleService?.record({
          source: "agent-host",
          severity: "warning",
          message: `Prompt cache key ${payload.cacheKeyFingerprint ?? "unknown"} reached ${payload.cacheKeyRequestsPerMinute ?? 0} requests in the rolling one-minute window. Artemis kept the key stable to preserve cache affinity.`,
        });
      }
    } else if (
      payload.type === "turn.completed" ||
      payload.type === "turn.failed"
    ) {
      if (payload.type === "turn.failed") {
        const overflow = parseContextOverflowTokens(payload.message);
        if (overflow) {
          trace.providerLimitTokens = overflow.providerLimitTokens;
          trace.providerRequestedTokens = overflow.providerRequestedTokens;
        }
      }
      trace.completedAt = now;
      trace.outcome =
        payload.type === "turn.completed" ? "completed" : "failed";
      setTimeout(() => {
        if (turnLatencyTraces.get(turnId) === trace) finalizeTurnLatency(trace);
      }, 250);
    }
  }

  function withPersistedTurnDuration(
    turnId: string | undefined,
    payload: AgentPayload,
  ): AgentPayload {
    if (
      !turnId ||
      (payload.type !== "turn.completed" && payload.type !== "turn.failed")
    ) {
      return payload;
    }
    const trace = turnLatencyTraces.get(turnId);
    if (!trace) return payload;
    const startedAt = trace.submittedAt ?? trace.mainReceivedAt;
    return {
      ...payload,
      durationMs: Math.max(0, Math.round(Date.now() - startedAt)),
    };
  }
  return {
    elapsed,
    finalizeTurnLatency,
    observeTurnPayload,
    withPersistedTurnDuration,
  };
}
