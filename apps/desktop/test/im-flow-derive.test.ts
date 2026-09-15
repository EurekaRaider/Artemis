// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  imFirstPendingStep,
  imFlowProgress,
  imFlowSteps,
  imReadVerify,
  imWriteVerify,
} from "../src/renderer/im-flow-derive.js";
import type { ImConnectionStatus } from "@artemis/protocol";

const connected: ImConnectionStatus = {
  id: "bot",
  name: "Bot",
  channel: "wecom",
  state: "connected",
};

function status(patch: Record<string, unknown> = {}) {
  return {
    state: "connected",
    settings: {
      enabled: true,
      deviceId: "device",
      grants: patch.grants ?? [{ projectId: "p", expiresAt: 1 }],
    },
    identities: patch.identities ?? [{ channel: "wecom" }],
    connections: patch.connections ?? [connected],
    ...patch,
  } as never;
}

describe("im flow derive (three-step chain)", () => {
  it("marks all three steps done for a fully configured device", () => {
    const steps = imFlowSteps(status());
    expect(steps.map((step) => step.id)).toEqual([
      "service",
      "channel",
      "projects",
    ]);
    expect(steps.every((step) => step.done)).toBe(true);
    expect(imFlowProgress(steps)).toBe(3);
    expect(imFirstPendingStep(steps)).toBeUndefined();
  });
  it("derives each step only from its real store signal", () => {
    const steps = imFlowSteps(
      status({
        settings: { enabled: false, deviceId: "", grants: [] },
        identities: [],
        connections: [{ ...connected, state: "connecting" }],
      }),
    );
    expect(steps.map((step) => step.done)).toEqual([false, false, false]);
    expect(imFlowProgress(steps)).toBe(0);
    expect(imFirstPendingStep(steps)).toBe("service");
  });
  it("holds channel done until the same channel is both connected and paired", () => {
    /* 跨渠道不成立：机器人连在 wecom，账号绑在 feishu。 */
    const crossChannel = imFlowSteps(
      status({ identities: [{ channel: "feishu" }] }),
    );
    expect(crossChannel.map((step) => step.done)).toEqual([
      true,
      false,
      true,
    ]);
    /* 同渠道成立。 */
    const sameChannel = imFlowSteps(status());
    expect(sameChannel[1]!.done).toBe(true);
  });
  it("falls back level by level when a connection is deleted", () => {
    const steps = imFlowSteps(status({ connections: [], identities: [] }));
    expect(steps.map((step) => step.done)).toEqual([true, false, true]);
    expect(imFirstPendingStep(steps)).toBe("channel");
  });
  it("keeps the optional verify out of the completion chain", () => {
    /* 验证是②尾可选段：确认与否都不改变完成链（D4 诚实版）。 */
    const confirmed = imFlowSteps(status());
    expect(imFlowProgress(confirmed)).toBe(3);
  });
  it("persists the optional verify per device with its channel", () => {
    expect(imReadVerify().confirmed).toBe(false);
    expect(imReadVerify("missing").confirmed).toBe(false);
    imWriteVerify("device-a", { confirmed: true, channel: "feishu" });
    expect(imReadVerify("device-a")).toEqual({
      confirmed: true,
      channel: "feishu",
    });
    expect(imReadVerify("device-b").confirmed).toBe(false);
    imWriteVerify("device-a", { confirmed: false });
    expect(imReadVerify("device-a").confirmed).toBe(false);
  });
});
