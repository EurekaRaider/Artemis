const TIMELINE_SCROLL_THRESHOLD = 80;

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
