import { type AppLocale, type ChildAgentPayload } from "@artemis/protocol";
import type { WorkspaceFileLink } from "../../shared/api.js";

export interface LiveChildActivity {
  activity: string;
  payload: ChildAgentPayload;
}

export type Locale = AppLocale;

export type ActiveView =
  "workspace" | "archive" | "resources" | "token-usage" | "automations";

export type SettingsEntryTab = "general" | "maintenance" | "hooks" | "im";

export type ConfirmationTone = "default" | "danger";

export type ToastContent =
  | string
  | { error: true; message: string }
  | { success: true; message: string };

export interface ToastState {
  content: ToastContent;
  fading: boolean;
  id: number;
}

export interface ConfirmationState {
  acceptLabel?: string;
  cancelLabel?: string;
  message: string;
  title?: string;
  tone: ConfirmationTone;
}

export interface FileLinkContextMenuState {
  file: WorkspaceFileLink;
  threadId: string;
  x: number;
  y: number;
}

export interface WorkspaceDockDrag {
  pointerId: number;
  startWidth: number;
  startX: number;
}

export interface ProjectSidebarDrag {
  pointerId: number;
  startWidth: number;
  startX: number;
}

export interface WorkspaceTabScrollState {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}
