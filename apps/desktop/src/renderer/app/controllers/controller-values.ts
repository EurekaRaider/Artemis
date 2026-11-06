import { type WorkspaceTabScrollState } from "../app-types.js";

export const TOAST_VISIBLE_MILLISECONDS = 10_000;

export const TOAST_FADE_MILLISECONDS = 600;

export const EMPTY_WORKSPACE_TAB_SCROLL_STATE: WorkspaceTabScrollState = {
  hasOverflow: false,
  canScrollLeft: false,
  canScrollRight: false,
};

export const WORKSPACE_TAB_SCROLL_INSET = 32;

export function modelIdentity(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}
