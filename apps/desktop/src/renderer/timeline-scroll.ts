const TIMELINE_SCROLL_THRESHOLD = 80;

export interface TimelineScrollSnapshot {
  pinned: boolean;
  scrollTop: number;
}

export function resolveTimelinePinned({
  clientHeight,
  pinned,
  scrollHeight,
  scrollTop,
  userInitiated,
}: {
  clientHeight: number;
  pinned: boolean;
  scrollHeight: number;
  scrollTop: number;
  userInitiated: boolean;
}): boolean {
  const nearBottom =
    scrollHeight - scrollTop - clientHeight < TIMELINE_SCROLL_THRESHOLD;
  return nearBottom || (pinned && !userInitiated);
}

export function resolveTimelineScrollTarget({
  clientHeight,
  scrollHeight,
  snapshot,
}: {
  clientHeight: number;
  scrollHeight: number;
  snapshot?: TimelineScrollSnapshot;
}): number {
  if (!snapshot || snapshot.pinned) return scrollHeight;
  return Math.min(
    Math.max(0, snapshot.scrollTop),
    Math.max(0, scrollHeight - clientHeight),
  );
}
