import { describe, expect, it } from "vitest";

import {
  AgentCapacityController,
  deriveAgentConcurrencyLimit,
  reclaimableMemoryPercent,
  SystemCpuSampler,
} from "../src/main/agent-capacity-controller.js";

const GIB_IN_KILOBYTES = 1024 * 1024;

describe("agent capacity controller", () => {
  it("derives a bounded startup limit from CPU and physical memory", () => {
    expect(
      deriveAgentConcurrencyLimit({
        parallelism: 4,
        totalMemoryKilobytes: 8 * GIB_IN_KILOBYTES,
      }),
    ).toBe(2);
    expect(
      deriveAgentConcurrencyLimit({
        parallelism: 15,
        totalMemoryKilobytes: 48 * GIB_IN_KILOBYTES,
      }),
    ).toBe(12);
    expect(
      deriveAgentConcurrencyLimit({
        parallelism: 64,
        totalMemoryKilobytes: 128 * GIB_IN_KILOBYTES,
      }),
    ).toBe(16);
  });

  it("uses the platform-specific reclaimable memory signal", () => {
    const memory = {
      total: 1_000,
      free: 50,
      available: 180,
      fileBacked: 0,
      purgeable: 70,
      swapTotal: 0,
      swapFree: 0,
    };
    expect(reclaimableMemoryPercent("linux", memory)).toBe(18);
    expect(reclaimableMemoryPercent("darwin", memory)).toBe(12);
    expect(reclaimableMemoryPercent("win32", memory)).toBe(5);
  });

  it("steps down after three pressure samples and recovers after twelve healthy samples", () => {
    const controller = new AgentCapacityController(
      { mode: "auto" },
      {
        parallelism: 15,
        totalMemoryKilobytes: 48 * GIB_IN_KILOBYTES,
      },
    );
    const pressure = {
      cpuPercent: 90,
      reclaimableMemoryPercent: 20,
      eventLoopP95Milliseconds: 20,
    };
    expect(controller.observe(pressure)).toBeUndefined();
    expect(controller.observe(pressure)).toBeUndefined();
    expect(controller.observe(pressure)).toMatchObject({
      limit: 11,
      reason: "pressure",
      pressureReasons: ["cpu"],
    });
    expect(controller.status()).toMatchObject({
      startupLimit: 12,
      effectiveLimit: 11,
      throttled: true,
    });

    const healthy = {
      cpuPercent: 40,
      reclaimableMemoryPercent: 30,
      eventLoopP95Milliseconds: 20,
    };
    for (let index = 0; index < 11; index += 1) {
      expect(controller.observe(healthy)).toBeUndefined();
    }
    expect(controller.observe(healthy)).toMatchObject({
      limit: 12,
      reason: "recovery",
    });
  });

  it("reduces admission on the first 150 ms event-loop pressure cycle", () => {
    const controller = new AgentCapacityController(
      { mode: "auto" },
      {
        parallelism: 15,
        totalMemoryKilobytes: 48 * GIB_IN_KILOBYTES,
      },
    );
    expect(
      controller.observe({
        cpuPercent: 40,
        reclaimableMemoryPercent: 30,
        eventLoopP95Milliseconds: 150,
      }),
    ).toMatchObject({
      limit: 11,
      reason: "pressure",
      pressureReasons: ["event-loop"],
    });
  });

  it("does not oscillate when required metrics are unavailable", () => {
    const controller = new AgentCapacityController(
      { mode: "manual", limit: 7 },
      { parallelism: 2, totalMemoryKilobytes: 4 * GIB_IN_KILOBYTES },
    );
    for (let index = 0; index < 20; index += 1) {
      expect(controller.observe({})).toBeUndefined();
    }
    expect(controller.status()).toMatchObject({
      configuredLimit: 7,
      automaticSafeLimit: 2,
      startupLimit: 2,
      effectiveLimit: 2,
    });
  });

  it("starts a manual 64 ceiling at the automatic safe limit and ramps up only while healthy", () => {
    const controller = new AgentCapacityController(
      { mode: "manual", limit: 64 },
      {
        parallelism: 15,
        totalMemoryKilobytes: 48 * GIB_IN_KILOBYTES,
      },
    );
    expect(controller.status()).toMatchObject({
      configuredLimit: 64,
      automaticSafeLimit: 12,
      startupLimit: 12,
      effectiveLimit: 12,
      hardLimit: 64,
      logicalLimit: 64,
      waiting: 0,
    });

    const healthy = {
      cpuPercent: 40,
      reclaimableMemoryPercent: 30,
      eventLoopP95Milliseconds: 20,
    };
    for (let index = 0; index < 12; index += 1) {
      controller.observe(healthy);
    }
    expect(controller.status().effectiveLimit).toBe(25);
  });

  it("ignores the first system CPU sample", () => {
    expect(new SystemCpuSampler().sample()).toBeUndefined();
  });
});
