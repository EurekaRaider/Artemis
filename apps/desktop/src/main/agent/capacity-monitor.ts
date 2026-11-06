import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";

import { app } from "electron";
import type { AgentConcurrencyRuntimeStatus } from "@artemis/protocol";
import {
  type AgentCapacityChange,
  reclaimableMemoryPercent,
  SystemCpuSampler,
} from "../agent/agent-capacity-controller.js";
import { type AgentConcurrencyStatus } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "diagnosticBundleService"
  | "agentProcess"
  | "agentCapacityRuntime"
  | "agentCapacityApplyTail"
  | "agentCapacityController"
  | "agentCapacityTimer"
  | "agentCapacityEventLoopDelay"
  | "agentCapacityMetricsWarningRecorded"
>;
export function createCapacityMonitor(services: Dependencies) {
  function recordAgentCapacityChange(change: AgentCapacityChange): void {
    const pressure = change.pressureReasons.length
      ? ` (${change.pressureReasons.join(", ")})`
      : "";
    services.diagnosticBundleService?.record({
      source: "main",
      severity: "info",
      message: `Agent concurrency ${change.reason}: effective limit ${change.limit}${pressure}.`,
    });
  }

  async function applyAgentCapacityChange(
    change: AgentCapacityChange,
  ): Promise<void> {
    if (!services.agentProcess?.available) {
      throw new Error("Agent host is unavailable.");
    }
    services.agentCapacityRuntime =
      await services.agentProcess.request<AgentConcurrencyRuntimeStatus>(
        {
          type: "runtime.concurrency.set",
          requestId: randomUUID(),
          limit: change.limit,
        },
        10_000,
      );
    recordAgentCapacityChange(change);
  }

  function scheduleAgentCapacityChange(change: AgentCapacityChange): void {
    services.agentCapacityApplyTail = services.agentCapacityApplyTail
      .then(() => applyAgentCapacityChange(change))
      .catch((error) => {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Agent concurrency change was not applied: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      });
  }

  async function agentConcurrencyStatus(
    refreshRuntime = true,
  ): Promise<AgentConcurrencyStatus> {
    if (!services.agentCapacityController) {
      throw new Error("Agent capacity controller is not ready.");
    }
    if (refreshRuntime && services.agentProcess?.available) {
      try {
        services.agentCapacityRuntime =
          await services.agentProcess.request<AgentConcurrencyRuntimeStatus>(
            {
              type: "runtime.concurrency.status",
              requestId: randomUUID(),
            },
            10_000,
          );
      } catch (error) {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Agent concurrency status is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
    return services.agentCapacityController.status(
      services.agentCapacityRuntime,
    );
  }

  function startAgentCapacityMonitoring(): void {
    if (!services.agentCapacityController || services.agentCapacityTimer)
      return;
    const cpuSampler = new SystemCpuSampler();
    services.agentCapacityEventLoopDelay = monitorEventLoopDelay({
      resolution: 20,
    });
    services.agentCapacityEventLoopDelay.enable();
    services.agentCapacityTimer = setInterval(() => {
      try {
        const memory = process.getSystemMemoryInfo();
        const memoryPercent = reclaimableMemoryPercent(
          process.platform,
          memory,
        );
        const workingSets = app
          .getAppMetrics()
          .map((metric) => metric.memory?.workingSetSize)
          .filter((value): value is number => Number.isFinite(value));
        const eventLoopP95Milliseconds =
          services.agentCapacityEventLoopDelay!.percentile(95) / 1_000_000;
        services.agentCapacityEventLoopDelay!.reset();
        const cpuPercent = cpuSampler.sample();
        const change = services.agentCapacityController!.observe({
          ...(cpuPercent === undefined ? {} : { cpuPercent }),
          ...(memoryPercent === undefined
            ? {}
            : { reclaimableMemoryPercent: memoryPercent }),
          eventLoopP95Milliseconds,
          ...(workingSets.length
            ? {
                appWorkingSetMiB:
                  workingSets.reduce((sum, value) => sum + value, 0) / 1024,
              }
            : {}),
        });
        if (change) scheduleAgentCapacityChange(change);
      } catch (error) {
        if (services.agentCapacityMetricsWarningRecorded) return;
        services.agentCapacityMetricsWarningRecorded = true;
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Agent capacity metrics are unavailable; the current limit will be retained: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }, 5_000);
    services.agentCapacityTimer.unref();
  }

  function stopAgentCapacityMonitoring(): void {
    if (services.agentCapacityTimer) clearInterval(services.agentCapacityTimer);
    services.agentCapacityTimer = undefined;
    services.agentCapacityEventLoopDelay?.disable();
    services.agentCapacityEventLoopDelay = undefined;
  }
  return {
    recordAgentCapacityChange,
    applyAgentCapacityChange,
    scheduleAgentCapacityChange,
    agentConcurrencyStatus,
    startAgentCapacityMonitoring,
    stopAgentCapacityMonitoring,
  };
}
