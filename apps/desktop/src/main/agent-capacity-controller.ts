import { availableParallelism, cpus } from "node:os";

import {
  AGENT_CONCURRENCY_AUTOMATIC_MAXIMUM,
  AGENT_CONCURRENCY_MAXIMUM,
  AGENT_CONCURRENCY_MINIMUM,
  AGENT_TEAM_LOGICAL_MAXIMUM,
  parseAgentConcurrencyPreference,
  type AgentConcurrencyPreference,
  type AgentConcurrencyPressureReason,
  type AgentConcurrencyStatus,
} from "../shared/agent-concurrency.js";

const SYSTEM_RESERVED_GIB = 4;
const MEMORY_PER_AGENT_GIB = 1.5;
const CPU_FRACTION = 0.8;
const PRESSURE_SAMPLES = 3;
const HEALTHY_SAMPLES = 12;

export interface AgentCapacityHardware {
  parallelism: number;
  totalMemoryKilobytes: number;
}

export interface AgentCapacitySample {
  cpuPercent?: number;
  reclaimableMemoryPercent?: number;
  eventLoopP95Milliseconds?: number;
  appWorkingSetMiB?: number;
}

export interface AgentConcurrencyRuntimeSnapshot {
  active: number;
  activeParents: number;
  waiting: number;
  queued: number;
  limit: number;
}

export interface AgentCapacityChange {
  limit: number;
  reason: "preference" | "pressure" | "recovery";
  pressureReasons: AgentConcurrencyPressureReason[];
}

export function deriveAgentConcurrencyLimit(
  hardware: AgentCapacityHardware,
): number {
  const parallelism = Math.max(1, Math.trunc(hardware.parallelism));
  const totalMemoryGiB = Math.max(
    0,
    hardware.totalMemoryKilobytes / 1024 / 1024,
  );
  const cpuCapacity = Math.max(
    AGENT_CONCURRENCY_MINIMUM,
    Math.floor(parallelism * CPU_FRACTION),
  );
  const memoryCapacity = Math.max(
    AGENT_CONCURRENCY_MINIMUM,
    Math.floor((totalMemoryGiB - SYSTEM_RESERVED_GIB) / MEMORY_PER_AGENT_GIB),
  );
  return Math.max(
    AGENT_CONCURRENCY_MINIMUM,
    Math.min(AGENT_CONCURRENCY_AUTOMATIC_MAXIMUM, cpuCapacity, memoryCapacity),
  );
}

export function reclaimableMemoryPercent(
  platform: NodeJS.Platform,
  memory: Electron.SystemMemoryInfo & { available?: number },
): number | undefined {
  if (!Number.isFinite(memory.total) || memory.total <= 0) return undefined;
  const available = memory.available;
  const reclaimable =
    platform === "linux" &&
    typeof available === "number" &&
    Number.isFinite(available)
      ? available
      : platform === "darwin"
        ? memory.free +
          (Number.isFinite(memory.purgeable) ? memory.purgeable : 0)
        : memory.free;
  if (!Number.isFinite(reclaimable) || reclaimable < 0) return undefined;
  return Math.max(0, Math.min(100, (reclaimable / memory.total) * 100));
}

interface CpuTotals {
  idle: number;
  total: number;
}

function cpuTotals(): CpuTotals | undefined {
  const processors = cpus();
  if (!processors.length) return undefined;
  let idle = 0;
  let total = 0;
  for (const processor of processors) {
    idle += processor.times.idle;
    total += Object.values(processor.times).reduce(
      (sum, value) => sum + value,
      0,
    );
  }
  return { idle, total };
}

export class SystemCpuSampler {
  private previous: CpuTotals | undefined;

  sample(): number | undefined {
    const current = cpuTotals();
    if (!current) return undefined;
    const previous = this.previous;
    this.previous = current;
    if (!previous) return undefined;
    const total = current.total - previous.total;
    const idle = current.idle - previous.idle;
    if (total <= 0 || idle < 0) return undefined;
    return Math.max(0, Math.min(100, (1 - idle / total) * 100));
  }
}

export function currentAgentCapacityHardware(
  memory: Electron.SystemMemoryInfo,
): AgentCapacityHardware {
  return {
    parallelism: availableParallelism(),
    totalMemoryKilobytes: memory.total,
  };
}

export class AgentCapacityController {
  private preference: AgentConcurrencyPreference;
  private readonly automaticSafeLimit: number;
  private configuredLimit: number;
  private startupLimit: number;
  private effectiveLimit: number;
  private pressureStreak = 0;
  private healthyStreak = 0;
  private pressureReasons: AgentConcurrencyPressureReason[] = [];
  private appWorkingSetMiB: number | undefined;

  constructor(
    preference: AgentConcurrencyPreference,
    private readonly hardware: AgentCapacityHardware,
  ) {
    this.preference = parseAgentConcurrencyPreference(preference);
    this.automaticSafeLimit = deriveAgentConcurrencyLimit(this.hardware);
    this.configuredLimit = this.limitForPreference(this.preference);
    this.startupLimit = Math.min(this.configuredLimit, this.automaticSafeLimit);
    this.effectiveLimit = this.startupLimit;
  }

  get limit(): number {
    return this.effectiveLimit;
  }

  setPreference(preference: AgentConcurrencyPreference): AgentCapacityChange {
    this.preference = parseAgentConcurrencyPreference(preference);
    this.configuredLimit = this.limitForPreference(this.preference);
    this.startupLimit = Math.min(this.configuredLimit, this.automaticSafeLimit);
    this.effectiveLimit = this.startupLimit;
    this.pressureStreak = 0;
    this.healthyStreak = 0;
    this.pressureReasons = [];
    return {
      limit: this.effectiveLimit,
      reason: "preference",
      pressureReasons: [],
    };
  }

  observe(sample: AgentCapacitySample): AgentCapacityChange | undefined {
    this.appWorkingSetMiB = sample.appWorkingSetMiB;
    const reasons: AgentConcurrencyPressureReason[] = [];
    if (sample.cpuPercent !== undefined && sample.cpuPercent >= 85) {
      reasons.push("cpu");
    }
    if (
      sample.eventLoopP95Milliseconds !== undefined &&
      sample.eventLoopP95Milliseconds >= 150
    ) {
      reasons.push("event-loop");
    }
    if (
      sample.reclaimableMemoryPercent !== undefined &&
      sample.reclaimableMemoryPercent <= 8
    ) {
      reasons.push("memory");
    }

    if (reasons.length) {
      this.pressureStreak = reasons.includes("event-loop")
        ? PRESSURE_SAMPLES
        : this.pressureStreak + 1;
      this.healthyStreak = 0;
      this.pressureReasons = reasons;
      if (
        this.pressureStreak >= PRESSURE_SAMPLES &&
        this.effectiveLimit > AGENT_CONCURRENCY_MINIMUM
      ) {
        this.pressureStreak = 0;
        this.effectiveLimit =
          this.effectiveLimit > this.automaticSafeLimit
            ? Math.max(
                AGENT_CONCURRENCY_MINIMUM,
                Math.min(
                  this.automaticSafeLimit,
                  Math.floor(this.effectiveLimit * 0.75),
                ),
              )
            : this.effectiveLimit - 1;
        return {
          limit: this.effectiveLimit,
          reason: "pressure",
          pressureReasons: [...this.pressureReasons],
        };
      }
      return undefined;
    }

    const healthy =
      sample.cpuPercent !== undefined &&
      sample.cpuPercent <= 60 &&
      sample.eventLoopP95Milliseconds !== undefined &&
      sample.eventLoopP95Milliseconds <= 75 &&
      sample.reclaimableMemoryPercent !== undefined &&
      sample.reclaimableMemoryPercent >= 12;
    this.pressureStreak = 0;
    if (!healthy) {
      this.healthyStreak = 0;
      return undefined;
    }
    this.healthyStreak += 1;
    if (
      this.healthyStreak >= HEALTHY_SAMPLES &&
      this.effectiveLimit < this.configuredLimit
    ) {
      this.healthyStreak = 0;
      this.effectiveLimit = Math.min(
        this.configuredLimit,
        this.effectiveLimit +
          Math.max(
            1,
            Math.ceil((this.configuredLimit - this.effectiveLimit) / 4),
          ),
      );
      if (this.effectiveLimit === this.configuredLimit) {
        this.pressureReasons = [];
      }
      return {
        limit: this.effectiveLimit,
        reason: "recovery",
        pressureReasons: [...this.pressureReasons],
      };
    }
    return undefined;
  }

  status(runtime?: AgentConcurrencyRuntimeSnapshot): AgentConcurrencyStatus {
    const effectiveLimit = runtime?.limit ?? this.effectiveLimit;
    return {
      preference: structuredClone(this.preference),
      configuredLimit: this.configuredLimit,
      automaticSafeLimit: this.automaticSafeLimit,
      startupLimit: this.startupLimit,
      effectiveLimit,
      active: runtime?.active ?? 0,
      waiting: runtime?.waiting ?? 0,
      queued: runtime?.queued ?? 0,
      hardLimit: AGENT_CONCURRENCY_MAXIMUM,
      logicalLimit: AGENT_TEAM_LOGICAL_MAXIMUM,
      throttled: effectiveLimit < this.configuredLimit,
      pressureReasons: [...this.pressureReasons],
      parallelism: this.hardware.parallelism,
      totalMemoryGiB: Number(
        (this.hardware.totalMemoryKilobytes / 1024 / 1024).toFixed(1),
      ),
      ...(this.appWorkingSetMiB === undefined
        ? {}
        : { appWorkingSetMiB: Number(this.appWorkingSetMiB.toFixed(1)) }),
    };
  }

  private limitForPreference(preference: AgentConcurrencyPreference): number {
    return preference.mode === "manual"
      ? preference.limit
      : deriveAgentConcurrencyLimit(this.hardware);
  }
}
