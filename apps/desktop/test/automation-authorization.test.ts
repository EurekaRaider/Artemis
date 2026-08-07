import { describe, expect, it } from "vitest";

import {
  automationAuthorizationFingerprint,
  automationMayAutoApprove,
} from "../src/main/automation-authorization.js";

const input = {
  projectId: "project-1",
  prompt: "Update dependencies and run tests.",
  mode: "execute" as const,
  target: "managed-worktree" as const,
  schedule: {
    kind: "weekly" as const,
    daysOfWeek: [1],
    localTime: "09:00",
    timeZone: "Asia/Shanghai",
  },
};

describe("automation authorization", () => {
  it("invalidates unattended authorization when executable configuration changes", () => {
    const fingerprint = automationAuthorizationFingerprint(input);
    expect(
      automationAuthorizationFingerprint({
        ...input,
        prompt: `${input.prompt} Publish the result.`,
      }),
    ).not.toBe(fingerprint);
    expect(
      automationAuthorizationFingerprint({
        ...input,
        schedule: { ...input.schedule, localTime: "10:00" },
      }),
    ).not.toBe(fingerprint);
  });

  it("auto-approves only a linked active Execute automation turn", () => {
    expect(
      automationMayAutoApprove({
        automationMode: "execute",
        authorizationState: "authorized",
        linkedThreadId: "thread-1",
        requestThreadId: "thread-1",
        activeTurnId: "turn-1",
        requestTurnId: "turn-1",
      }),
    ).toBe(true);
    expect(
      automationMayAutoApprove({
        automationMode: "execute",
        authorizationState: "authorized",
        linkedThreadId: "thread-1",
        requestThreadId: "manual-thread",
        activeTurnId: "turn-1",
        requestTurnId: "turn-1",
      }),
    ).toBe(false);
    expect(
      automationMayAutoApprove({
        automationMode: "review",
        authorizationState: "authorized",
        linkedThreadId: "thread-1",
        requestThreadId: "thread-1",
        activeTurnId: "turn-1",
        requestTurnId: "turn-1",
      }),
    ).toBe(false);
  });
});
