export const PROJECT_SIDEBAR_WIDTH_DEFAULT = 252;
export const PROJECT_SIDEBAR_WIDTH_MIN = 208;
export const PROJECT_SIDEBAR_WIDTH_MAX = 420;

export function clampProjectSidebarWidth(width: number): number {
  return Math.max(
    PROJECT_SIDEBAR_WIDTH_MIN,
    Math.min(PROJECT_SIDEBAR_WIDTH_MAX, Math.round(width)),
  );
}
