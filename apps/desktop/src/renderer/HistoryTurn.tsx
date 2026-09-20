import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const measuredHeights = new Map<string, number>();
const PLACEHOLDER_DEFAULT_HEIGHT = 180;

// Guess a placeholder height from the average of already-measured turns of
// the same thread. A fixed guess is wildly wrong for tool-heavy turns (which
// run thousands of pixels tall), and every wrong placeholder exposes itself
// as a blank band while its IntersectionObserver callback is still pending.
function estimatePlaceholderHeight(cacheKey: string): number {
  const separator = cacheKey.indexOf(":");
  const threadPrefix =
    separator > 0 ? `${cacheKey.slice(0, separator + 1)}` : undefined;
  if (!threadPrefix) return PLACEHOLDER_DEFAULT_HEIGHT;
  let total = 0;
  let count = 0;
  for (const [key, height] of measuredHeights) {
    if (!key.startsWith(threadPrefix)) continue;
    total += height;
    count += 1;
  }
  if (count === 0) return PLACEHOLDER_DEFAULT_HEIGHT;
  return Math.min(2_400, Math.max(160, Math.round(total / count)));
}

// Keep measured space for offscreen turns while releasing their expensive DOM.
export function HistoryTurn({
  children,
  cacheKey,
  initialVisible,
  active,
}: {
  children: () => ReactNode;
  cacheKey: string;
  initialVisible: boolean;
  active: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const height = useRef<number | undefined>(undefined);
  if (height.current === undefined) {
    height.current =
      measuredHeights.get(cacheKey) ?? estimatePlaceholderHeight(cacheKey);
  }
  const [visible, setVisible] = useState(initialVisible || active);
  // Synchronous visibility check shared by first paint and scroll events:
  // the IntersectionObserver callback is async, so a placeholder can sit
  // inside the viewport for several frames (or seconds under load, e.g.
  // right after a thread switch restores scrollTop to the bottom) before
  // the observer mounts it. Mount immediately on intersect.
  const checkInView = () => {
    const element = root.current;
    const scroller = element?.closest(".timeline-scroll");
    if (!element || !scroller) return;
    const elementRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    if (
      elementRect.bottom >= scrollerRect.top &&
      elementRect.top <= scrollerRect.bottom
    ) {
      setVisible(true);
      return true;
    }
    return false;
  };
  useLayoutEffect(() => {
    checkInView();
  }, []);
  // Programmatic scroll restoration (thread switch) happens after mount;
  // re-check synchronously on scroll instead of waiting for the observer.
  useEffect(() => {
    const scroller = root.current?.closest(".timeline-scroll");
    if (!scroller) return;
    let scheduled: number | undefined;
    const onScroll = () => {
      if (scheduled !== undefined) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = undefined;
        checkInView();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (scheduled !== undefined) cancelAnimationFrame(scheduled);
    };
  }, []);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry)
          setVisible(
            entry.isIntersecting ||
              Boolean(element.querySelector("details[open]")) ||
              element.contains(document.activeElement),
          );
      },
      { root: element.closest(".timeline-scroll"), rootMargin: "1600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (
      !element ||
      !(visible || active) ||
      typeof ResizeObserver === "undefined"
    )
      return;
    const observer = new ResizeObserver(() => {
      height.current =
        element.getBoundingClientRect().height ||
        height.current ||
        PLACEHOLDER_DEFAULT_HEIGHT;
      measuredHeights.delete(cacheKey);
      measuredHeights.set(cacheKey, height.current);
      if (measuredHeights.size > 4_096)
        measuredHeights.delete(measuredHeights.keys().next().value!);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, active, cacheKey]);
  return (
    <div
      ref={root}
      style={visible || active ? undefined : { height: height.current }}
      data-history-turn=""
      data-mounted={visible || active ? "true" : "false"}
    >
      {visible || active ? children() : null}
    </div>
  );
}
