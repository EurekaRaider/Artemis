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

  it("auto-approves reads and reversible MCP writes", () => {
    for (const policy of ["ask", "agent", "custom", "full-access"] as const) {
      for (const operation of [
        {
          kind: "mcp.call",
          readOnly: true,
          destructive: false,
          network: false,
        },
        {
          kind: "mcp.call",
          readOnly: false,
          destructive: false,
          network: true,
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

  it("auto-approves the exact trusted Google plugin action allowlists", () => {
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

    for (const policy of ["ask", "agent", "custom", "full-access"] as const) {
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
                toolName,
                googleGrant,
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
            ...operation,
          },
          true,
        ),
      ).toBe(false);
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
