export const MIN_CONVERSATION_WIDTH = 320;
export const MIN_WORKSPACE_DOCK_WIDTH = 320;
export const MAX_WORKSPACE_DOCK_WIDTH = 1_080;
export const WORKSPACE_DOCK_RESIZER_WIDTH = 7;

export interface WorkspaceDockWidthBounds {
  min: number;
  max: number;
}

export type WorkspaceDirection = "ltr" | "rtl";
export type WorkspaceDockResizeKey =
  "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function workspaceDockWidthBounds(
  workspaceWidth: number,
  viewportWidth: number,
  reservedWorkspaceWidth = 0,
): WorkspaceDockWidthBounds {
  const responsiveMinimum =
    viewportWidth <= 820 ? 320 : viewportWidth <= 1_100 ? 380 : 440;
  const availableMaximum = Math.floor(
    workspaceWidth -
      MIN_CONVERSATION_WIDTH -
      WORKSPACE_DOCK_RESIZER_WIDTH -
      Math.max(0, reservedWorkspaceWidth),
  );
  const max = Math.max(
    MIN_WORKSPACE_DOCK_WIDTH,
    Math.min(MAX_WORKSPACE_DOCK_WIDTH, availableMaximum),
  );
  return {
    min: Math.min(responsiveMinimum, max),
    max,
  };
}

export function clampWorkspaceDockWidth(
  width: number,
  bounds: WorkspaceDockWidthBounds,
): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
}

export function workspaceDockWidthAfterPointer(
  startWidth: number,
  startX: number,
  clientX: number,
  direction: WorkspaceDirection,
  bounds: WorkspaceDockWidthBounds,
): number {
  const delta = direction === "rtl" ? clientX - startX : startX - clientX;
  return clampWorkspaceDockWidth(startWidth + delta, bounds);
}

export function workspaceDockWidthAfterKey(
  currentWidth: number,
  key: WorkspaceDockResizeKey,
  direction: WorkspaceDirection,
  bounds: WorkspaceDockWidthBounds,
  workspaceWidth: number,
  step: number,
): number {
  if (key === "Home") {
    return clampWorkspaceDockWidth(workspaceWidth * 0.62, bounds);
  }
  if (key === "End") return bounds.max;
  const increaseKey = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
  return clampWorkspaceDockWidth(
    currentWidth + (key === increaseKey ? step : -step),
    bounds,
  );
}
