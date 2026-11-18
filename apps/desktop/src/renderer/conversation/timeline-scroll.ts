const TIMELINE_SCROLL_THRESHOLD = 80;

export interface TimelineScrollSnapshot {
  pinned: boolean;
  scrollTop: number;
  scrollExtent?: number;
}

export interface PendingTimelineRestore {
  threadId: string;
  snapshot?: TimelineScrollSnapshot;
}

export function prepareTimelineRestore(
  threadId: string | undefined,
  activeView: string,
  snapshot: TimelineScrollSnapshot | undefined,
): PendingTimelineRestore | undefined {
  if (!threadId || activeView !== "workspace") return undefined;
  return {
    threadId,
    ...(snapshot ? { snapshot } : {}),
  };
}

// Native wheel chaining from an iframe moves the viewport without a wheel
// event on the parent. Ignore offsets changed by resizing the scroll range.
export function scrolledUpInTimeline(
  previous: TimelineScrollSnapshot | undefined,
  scrollTop: number,
  scrollExtent: number,
): boolean {
  return (
    previous?.scrollExtent === scrollExtent && scrollTop < previous.scrollTop
  );
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
