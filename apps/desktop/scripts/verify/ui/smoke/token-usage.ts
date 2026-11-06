import { BrowserWindow } from "electron";
import type { AgentEvent } from "@artemis/protocol";
import { PROTOCOL_VERSION } from "@artemis/protocol";
import { IPC } from "../../../../src/shared/api.js";

import { smokeMode } from "../../../../test/fixtures/smoke/environment.js";

export const SMOKE_CARD_HEATMAP_USAGE_DAYS: readonly {
  daysAgo: number;
  totalTokens: number;
}[] = [
  { daysAgo: 0, totalTokens: 38_000 },
  { daysAgo: 1, totalTokens: 28_000 },
  { daysAgo: 2, totalTokens: 19_000 },
  { daysAgo: 3, totalTokens: 9_000 },
  { daysAgo: 7, totalTokens: 36_000 },
  { daysAgo: 8, totalTokens: 21_000 },
  { daysAgo: 15, totalTokens: 15_000 },
  { daysAgo: 22, totalTokens: 7_000 },
  { daysAgo: 33, totalTokens: 34_000 },
  { daysAgo: 47, totalTokens: 26_000 },
  { daysAgo: 61, totalTokens: 13_000 },
  { daysAgo: 76, totalTokens: 6_000 },
  { daysAgo: 100, totalTokens: 37_000 },
  { daysAgo: 130, totalTokens: 24_000 },
  { daysAgo: 160, totalTokens: 17_000 },
  { daysAgo: 190, totalTokens: 8_000 },
  { daysAgo: 230, totalTokens: 33_000 },
  { daysAgo: 270, totalTokens: 27_000 },
  { daysAgo: 310, totalTokens: 14_000 },
  { daysAgo: 350, totalTokens: 5_000 },
];

export function emitSmokeCardHeatmapUsageEvents(target: BrowserWindow): void {
  // The smokeMode guard matches seedSmokeIconSizingFixture: injection must
  // stay a smoke-harness-only behavior so a merely VIEW-tagged process can
  // never receive synthetic usage events (non-smoke paths are unchanged).
  if (
    !smokeMode ||
    !["card-heatmap", "secondary-pages-token-usage"].includes(
      process.env.ARTEMIS_SMOKE_VIEW ?? "",
    )
  ) {
    return;
  }
  if (process.env.ARTEMIS_SMOKE_REVIEW06_USAGE === "empty") return;
  const now = new Date();
  const threadId = "artemis-smoke-card-heatmap-thread";
  for (const day of SMOKE_CARD_HEATMAP_USAGE_DAYS) {
    // Calendar-exact local noon so the renderer's timezone date key maps
    // each event to the intended heatmap column on every machine.
    const stamped = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - day.daysAgo,
      12,
    );
    const inputTokens = Math.round(day.totalTokens * 0.6);
    target.webContents.send(IPC.agentEvent, {
      protocolVersion: PROTOCOL_VERSION,
      eventId: `artemis-smoke-card-heatmap-${day.daysAgo}`,
      threadId,
      turnId: `artemis-smoke-card-heatmap-turn-${day.daysAgo}`,
      seq: 0,
      timestamp: stamped.toISOString(),
      payload: {
        type: "assistant.usage",
        providerId: "artemis-smoke",
        modelId: "card-heatmap-probe",
        inputTokens,
        outputTokens: day.totalTokens - inputTokens,
        cacheReadTokens:
          process.env.ARTEMIS_SMOKE_REVIEW06_USAGE === "reported"
            ? Math.round(inputTokens * 0.63)
            : 0,
        ...(process.env.ARTEMIS_SMOKE_REVIEW06_USAGE === "reported"
          ? { cacheReadReported: true }
          : {}),
        cacheWriteTokens: 0,
        totalTokens: day.totalTokens,
      },
    } satisfies AgentEvent);
  }
}
