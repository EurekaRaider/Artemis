import type { ApprovalPolicy } from "@artemis/protocol";

export type ApprovalOperation =
  | { kind: "workspace.write"; modelApproved: boolean }
  | { kind: "shell.execute"; modelApproved: boolean }
  | {
      kind: "mcp.call";
      readOnly: boolean;
      destructive: boolean;
      network: boolean;
      toolName?: string;
      googleGrant?: "gmail" | "google-workspace";
    }
  | {
      kind: "extension.call";
      allowNetwork: boolean;
      modelApproved: boolean;
    };

const TRUSTED_GOOGLE_TOOL_ALLOWLISTS = {
  gmail: new Set([
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
  ]),
  "google-workspace": new Set([
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
  ]),
} satisfies Record<"gmail" | "google-workspace", Set<string>>;

export function shouldAutoApprove(
  policy: ApprovalPolicy,
  operation: ApprovalOperation,
  fullAccessAvailable: boolean,
): boolean {
  if (operation.kind === "mcp.call") {
    return (
      !operation.destructive ||
      (operation.googleGrant !== undefined &&
        operation.toolName !== undefined &&
        TRUSTED_GOOGLE_TOOL_ALLOWLISTS[operation.googleGrant].has(
          operation.toolName,
        ))
    );
  }
  if (policy === "full-access") {
    return fullAccessAvailable;
  }
  if (policy !== "agent") {
    return false;
  }
  return operation.modelApproved;
}
