// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  imFirstPendingStep,
  imFlowProgress,
  imFlowSteps,
  imReadTestConfirmed,
  imWriteTestConfirmed,
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
    identities: patch.identities ?? [{}],
    connections: patch.connections ?? [connected],
    ...patch,
  } as never;
}

describe("im flow derive", () => {
  it("marks all five steps done for a fully configured device", () => {
    const steps = imFlowSteps(status(), true);
    expect(steps.every((step) => step.done)).toBe(true);
    expect(imFlowProgress(steps)).toBe(5);
    expect(imFirstPendingStep(steps)).toBeUndefined();
  });
  it("derives each step only from its real store signal", () => {
    const steps = imFlowSteps(
      status({
        settings: { enabled: false, deviceId: "", grants: [] },
        identities: [],
        connections: [{ ...connected, state: "connecting" }],
      }),
      false,
    );
    expect(steps.map((step) => step.done)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(imFlowProgress(steps)).toBe(0);
    expect(imFirstPendingStep(steps)).toBe("service");
  });
  it("falls back level by level when a connection is deleted", () => {
    const steps = imFlowSteps(
      status({ connections: [], identities: [] }),
      true,
    );
    expect(steps.map((step) => step.done)).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
    expect(imFirstPendingStep(steps)).toBe("bots");
  });
  it("persists the step-5 confirmation per device", () => {
    expect(imReadTestConfirmed()).toBe(false);
    expect(imReadTestConfirmed("missing")).toBe(false);
    imWriteTestConfirmed("device-a", true);
    expect(imReadTestConfirmed("device-a")).toBe(true);
    expect(imReadTestConfirmed("device-b")).toBe(false);
    imWriteTestConfirmed("device-a", false);
    expect(imReadTestConfirmed("device-a")).toBe(false);
  });
});
