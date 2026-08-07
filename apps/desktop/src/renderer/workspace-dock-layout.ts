export const MIN_CONVERSATION_WIDTH = 320;
export const MIN_WORKSPACE_DOCK_WIDTH = 320;
export const MAX_WORKSPACE_DOCK_WIDTH = 1_080;
export const WORKSPACE_DOCK_RESIZER_WIDTH = 7;

export interface WorkspaceDockWidthBounds {
  min: number;
  max: number;
}

export function workspaceDockWidthBounds(
  workspaceWidth: number,
  viewportWidth: number,
): WorkspaceDockWidthBounds {
  const responsiveMinimum =
    viewportWidth <= 820 ? 320 : viewportWidth <= 1_100 ? 380 : 440;
  const availableMaximum = Math.floor(
    workspaceWidth - MIN_CONVERSATION_WIDTH - WORKSPACE_DOCK_RESIZER_WIDTH,
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
