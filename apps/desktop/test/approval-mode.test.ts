import { describe, expect, it } from "vitest";

import {
  effectiveApprovalRisk,
  shouldAutoApprove,
} from "../src/main/approval-mode.js";

describe("approval modes", () => {
  it("keeps non-MCP operations manual in request-approval or custom mode", () => {
    for (const policy of ["ask", "custom"] as const) {
      expect(
        shouldAutoApprove(
          policy,
          {
            kind: "workspace.write",
            minimumRisk: "medium",
            modelApproval: {
              risk: "low",
              explicitUserRequest: false,
              reason: "The change is scoped to the workspace.",
            },
          },
          true,
        ),
      ).toBe(false);
    }
  });

  it("auto-approves reads and reversible MCP writes", () => {
    for (const policy of ["ask", "agent", "custom", "full-access"] as const) {
      for (const operation of [
        {
          kind: "mcp.call",
          readOnly: true,
          destructive: false,
          network: false,
          fullAccess: false,
          modelApproval: {
            risk: "low",
            explicitUserRequest: false,
            reason: "Read-only inspection.",
          },
        },
        {
          kind: "mcp.call",
          readOnly: false,
          destructive: false,
          network: true,
          fullAccess: false,
          modelApproval: {
            risk: "medium",
            explicitUserRequest: false,
            reason: "A reversible remote update.",
          },
        },
      ] as const) {
        for (const nativeSandboxAvailable of [false, true]) {
          expect(
            shouldAutoApprove(policy, operation, nativeSandboxAvailable),
          ).toBe(true);
        }
      }
    }
  });

  it("retains exact trusted Google allowlists outside agent review", () => {
    const allowlists = [
      [
        "gmail",
        [
          "gmail_update_draft",
          "gmail_delete_draft",
          "gmail_send_draft",
          "gmail_send_message",
          "gmail_reply",
          "gmail_forward",
          "gmail_update_label",
          "gmail_delete_label",
          "gmail_trash_thread",
          "gmail_untrash_thread",
        ],
      ],
      [
        "google-workspace",
        [
          "gdrive_move",
          "gdrive_trash",
          "gdrive_restore",
          "gdocs_batch_update",
          "gslides_batch_update",
          "gsheets_update",
          "gsheets_clear",
          "gcalendar_create_event",
          "gcalendar_update_event",
          "gcalendar_cancel_event",
        ],
      ],
    ] as const;

    for (const policy of ["ask", "custom", "full-access"] as const) {
      for (const [googleGrant, toolNames] of allowlists) {
        for (const toolName of toolNames) {
          expect(
            shouldAutoApprove(
              policy,
              {
                kind: "mcp.call",
                readOnly: false,
                destructive: true,
                network: false,
                fullAccess: false,
                toolName,
                googleGrant,
                modelApproval: {
                  risk: "high",
                  explicitUserRequest: false,
                  reason: "A destructive Google operation.",
                },
              },
              false,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it("keeps unknown or cross-grant destructive MCP actions manual", () => {
    for (const operation of [
      { toolName: "gmail_future_destructive", googleGrant: "gmail" },
      {
        toolName: "workspace_future_destructive",
        googleGrant: "google-workspace",
      },
      { toolName: "gmail_send_message" },
      { toolName: "gmail_send_message", googleGrant: "google-workspace" },
      { toolName: "gdrive_trash", googleGrant: "gmail" },
    ] as const) {
      expect(
        shouldAutoApprove(
          "ask",
          {
            kind: "mcp.call",
            readOnly: false,
            destructive: true,
            network: false,
            fullAccess: false,
            modelApproval: {
              risk: "high",
              explicitUserRequest: false,
              reason: "A destructive MCP operation.",
            },
            ...operation,
          },
          true,
        ),
      ).toBe(false);
    }
  });

  it("auto-approves low and medium model risk in agent mode", () => {
    expect(
      shouldAutoApprove(
        "agent",
        {
          kind: "workspace.write",
          minimumRisk: "medium",
          modelApproval: {
            risk: "low",
            explicitUserRequest: false,
            reason: "A scoped workspace edit.",
          },
        },
        true,
      ),
    ).toBe(true);
    expect(
      shouldAutoApprove(
        "agent",
        {
          kind: "shell.execute",
          minimumRisk: "medium",
          modelApproval: {
            risk: "medium",
            explicitUserRequest: false,
            reason: "A reversible project build.",
          },
        },
        true,
      ),
    ).toBe(true);
  });

  it("requires high-risk actions to match an explicit user request", () => {
    expect(
      shouldAutoApprove(
        "agent",
        {
          kind: "shell.execute",
          minimumRisk: "medium",
          modelApproval: {
            risk: "high",
            explicitUserRequest: false,
            reason: "Publishing was inferred rather than requested.",
          },
        },
        true,
      ),
    ).toBe(false);
    expect(
      shouldAutoApprove(
        "agent",
        {
          kind: "shell.execute",
          minimumRisk: "medium",
          modelApproval: {
            risk: "high",
            explicitUserRequest: true,
            reason: "The user explicitly requested this exact publication.",
          },
        },
        true,
      ),
    ).toBe(true);
  });

  it("uses trusted host metadata as a minimum risk", () => {
    expect(
      effectiveApprovalRisk({
        kind: "mcp.call",
        readOnly: true,
        destructive: false,
        network: true,
        fullAccess: false,
        modelApproval: {
          risk: "low",
          explicitUserRequest: false,
          reason: "A remote read.",
        },
      }),
    ).toBe("medium");
    expect(
      shouldAutoApprove(
        "agent",
        {
          kind: "mcp.call",
          readOnly: false,
          destructive: true,
          network: true,
          fullAccess: false,
          toolName: "gmail_send_message",
          googleGrant: "gmail",
          modelApproval: {
            risk: "low",
            explicitUserRequest: false,
            reason: "The model underestimated the operation.",
          },
        },
        true,
      ),
    ).toBe(false);
    expect(
      shouldAutoApprove(
        "agent",
        {
          kind: "mcp.call",
          readOnly: false,
          destructive: true,
          network: true,
          fullAccess: false,
          modelApproval: {
            risk: "low",
            explicitUserRequest: true,
            reason: "The user explicitly requested the exact destructive call.",
          },
        },
        true,
      ),
    ).toBe(true);
  });

  it("treats an unsandboxed local MCP call as high risk", () => {
    const operation = {
      kind: "mcp.call" as const,
      readOnly: true,
      destructive: false,
      network: false,
      fullAccess: true,
      modelApproval: {
        risk: "low" as const,
        explicitUserRequest: false,
        reason: "The model classified the advertised tool as read-only.",
      },
    };

    expect(effectiveApprovalRisk(operation)).toBe("high");
    expect(shouldAutoApprove("agent", operation, true)).toBe(false);
    expect(shouldAutoApprove("ask", operation, true)).toBe(false);
    expect(
      shouldAutoApprove(
        "agent",
        {
          ...operation,
          modelApproval: {
            ...operation.modelApproval,
            explicitUserRequest: true,
          },
        },
        true,
      ),
    ).toBe(true);
  });

  it("requires the native sandbox before full access can auto-approve", () => {
    expect(
      shouldAutoApprove(
        "full-access",
        {
          kind: "workspace.write",
          minimumRisk: "medium",
          modelApproval: {
            risk: "high",
            explicitUserRequest: false,
            reason: "A high-risk workspace action.",
          },
        },
        false,
      ),
    ).toBe(false);
    expect(
      shouldAutoApprove(
        "full-access",
        {
          kind: "extension.call",
          allowNetwork: true,
          modelApproval: {
            risk: "high",
            explicitUserRequest: false,
            reason: "A networked extension action.",
          },
        },
        true,
      ),
    ).toBe(true);
  });
});
