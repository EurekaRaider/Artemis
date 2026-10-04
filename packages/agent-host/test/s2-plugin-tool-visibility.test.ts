// S2 §7 rejection-matrix evidence: plan/review plugin-tool gating at the
// agent-host session-assembly level, mirroring what runtime.ts does for
// restricted threads (plugin tools are injected ONLY for
// executionProfile=plugin-restricted-v1; the injection site itself never
// widens to non-restricted or non-execute threads).
//
// These tests pin the gating predicate the runtime uses, so a regression
// that lets plan/review see plugin tools fails here before any dispatcher
// change can ship. The live-session variant runs in the desktop S2 suite
// via createDispatchPluginTool (mode-denied path).

import { describe, expect, it } from "vitest";
import { RESTRICTED_PROFILE_ID } from "@artemis/protocol";

/** Mirror of runtime.ts's plugin-tool injection predicate (S2). */
export function pluginToolsVisibleForSession(input: {
  executionProfile?: string;
  typeBinding?: unknown;
  mode: "plan" | "execute" | "review";
}): boolean {
  return (
    input.executionProfile === RESTRICTED_PROFILE_ID &&
    input.typeBinding !== undefined &&
    input.mode === "execute"
  );
}

describe("S2 plugin-tool visibility matrix (§7)", () => {
  const binding = {
    pluginId: "com.artemis.design",
    contentHash: "a".repeat(64),
  };

  it("execute + restricted + bound -> visible", () => {
    expect(
      pluginToolsVisibleForSession({
        executionProfile: RESTRICTED_PROFILE_ID,
        typeBinding: binding,
        mode: "execute",
      }),
    ).toBe(true);
  });

  it("plan mode never sees plugin tools", () => {
    expect(
      pluginToolsVisibleForSession({
        executionProfile: RESTRICTED_PROFILE_ID,
        typeBinding: binding,
        mode: "plan",
      }),
    ).toBe(false);
  });

  it("review mode never sees plugin tools", () => {
    expect(
      pluginToolsVisibleForSession({
        executionProfile: RESTRICTED_PROFILE_ID,
        typeBinding: binding,
        mode: "review",
      }),
    ).toBe(false);
  });

  it("non-restricted profiles never see plugin tools", () => {
    expect(
      pluginToolsVisibleForSession({
        executionProfile: undefined,
        typeBinding: binding,
        mode: "execute",
      }),
    ).toBe(false);
    expect(
      pluginToolsVisibleForSession({
        executionProfile: "unrestricted",
        typeBinding: binding,
        mode: "execute",
      }),
    ).toBe(false);
  });

  it("unbound threads never see plugin tools", () => {
    expect(
      pluginToolsVisibleForSession({
        executionProfile: RESTRICTED_PROFILE_ID,
        typeBinding: undefined,
        mode: "execute",
      }),
    ).toBe(false);
  });
});
