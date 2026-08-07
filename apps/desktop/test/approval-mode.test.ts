import { describe, expect, it } from "vitest";

import { shouldAutoApprove } from "../src/main/approval-mode.js";

describe("approval modes", () => {
  it("keeps non-MCP operations manual in request-approval or custom mode", () => {
    for (const policy of ["ask", "custom"] as const) {
      expect(
        shouldAutoApprove(
          policy,
          { kind: "workspace.write", modelApproved: true },
          true,
        ),
      ).toBe(false);
    }
  });

  it("does not ask per call after a local MCP server is enabled", () => {
    for (const policy of ["ask", "agent", "custom", "full-access"] as const) {
      for (const operation of [
        { kind: "mcp.call", readOnly: true, network: false },
        { kind: "mcp.call", readOnly: false, network: true },
      ] as const) {
        for (const nativeSandboxAvailable of [false, true]) {
          expect(
            shouldAutoApprove(policy, operation, nativeSandboxAvailable),
          ).toBe(true);
        }
      }
    }
  });

  it("lets the model decide auto-approval in agent mode", () => {
    expect(
      shouldAutoApprove(
        "agent",
        { kind: "workspace.write", modelApproved: true },
        true,
      ),
    ).toBe(true);
    expect(
      shouldAutoApprove(
        "agent",
        { kind: "workspace.write", modelApproved: false },
        true,
      ),
    ).toBe(false);
    expect(
      shouldAutoApprove(
        "agent",
        { kind: "shell.execute", modelApproved: false },
        true,
      ),
    ).toBe(false);
    expect(
      shouldAutoApprove(
        "agent",
        {
          kind: "extension.call",
          allowNetwork: false,
          modelApproved: true,
        },
        true,
      ),
    ).toBe(true);
  });

  it("requires the native sandbox before full access can auto-approve", () => {
    expect(
      shouldAutoApprove(
        "full-access",
        { kind: "workspace.write", modelApproved: false },
        false,
      ),
    ).toBe(false);
    expect(
      shouldAutoApprove(
        "full-access",
        {
          kind: "extension.call",
          allowNetwork: true,
          modelApproved: false,
        },
        true,
      ),
    ).toBe(true);
  });
});
