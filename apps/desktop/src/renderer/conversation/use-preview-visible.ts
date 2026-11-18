import { useEffect, useRef, useState } from "react";

interface ScrollerActivity {
  scrolling: boolean;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  flushFrame: number | undefined;
  queue: Set<() => void>;
  subscribers: number;
  cleanup: () => void;
}

const scrollerActivities = new WeakMap<Element, ScrollerActivity>();
const SCROLL_IDLE_MS = 180;
const PREVIEW_DWELL_MS = 100;

function acquireScrollerActivity(scroller: Element): ScrollerActivity {
  let activity = scrollerActivities.get(scroller);
  if (!activity) {
    const queue = new Set<() => void>();
    const flushNext = () => {
      if (!activity || activity.scrolling) {
        if (activity) activity.flushFrame = undefined;
        return;
      }
      const next = queue.values().next().value;
      if (!next) {
        activity.flushFrame = undefined;
        return;
      }
      queue.delete(next);
      next();
      if (queue.size > 0) {
        activity.flushFrame = requestAnimationFrame(flushNext);
      } else {
        activity.flushFrame = undefined;
      }
    };
    const onIdle = () => {
      if (!activity) return;
      activity.scrolling = false;
      activity.idleTimer = undefined;
      if (scroller instanceof HTMLElement) {
        delete scroller.dataset.scrolling;
      }
      if (queue.size > 0 && activity.flushFrame === undefined) {
        activity.flushFrame = requestAnimationFrame(flushNext);
      }
    };
    const onScroll = () => {
      if (!activity) return;
      if (!activity.scrolling) {
        activity.scrolling = true;
        if (scroller instanceof HTMLElement) {
          scroller.dataset.scrolling = "true";
        }
      }
      if (activity.flushFrame !== undefined) {
        cancelAnimationFrame(activity.flushFrame);
        activity.flushFrame = undefined;
      }
      clearTimeout(activity.idleTimer);
      activity.idleTimer = setTimeout(onIdle, SCROLL_IDLE_MS);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    activity = {
      scrolling: false,
      idleTimer: undefined,
      flushFrame: undefined,
      queue,
      subscribers: 0,
      cleanup: () => {
        scroller.removeEventListener("scroll", onScroll);
        if (activity?.idleTimer !== undefined) clearTimeout(activity.idleTimer);
        if (activity?.flushFrame !== undefined)
          cancelAnimationFrame(activity.flushFrame);
        if (scroller instanceof HTMLElement) {
          delete scroller.dataset.scrolling;
        }
        queue.clear();
        scrollerActivities.delete(scroller);
      },
    };
    scrollerActivities.set(scroller, activity);
  }
  activity.subscribers += 1;
  return activity;
}

function releaseScrollerActivity(
  scroller: Element,
  activity: ScrollerActivity,
) {
  activity.subscribers -= 1;
  if (activity.subscribers <= 0) {
    activity.cleanup();
  }
}

/** Mount expensive readers only when their placeholder approaches the viewport. */
export function usePreviewVisible(suspendOffscreen = false) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const scroller = element.closest(".timeline-scroll");
    const activity = scroller ? acquireScrollerActivity(scroller) : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let near = false;

    const runShow = () => {
      if (near) setVisible(true);
    };
    const runSuspend = () => {
      if (!near && !element.contains(document.activeElement)) {
        setVisible(false);
      }
    };
    const stopWaiting = () => {
      clearTimeout(timer);
      timer = undefined;
      activity?.queue.delete(runShow);
      activity?.queue.delete(runSuspend);
    };
    const scheduleShow = () => {
      clearTimeout(timer);
      timer = undefined;
      if (activity?.scrolling) {
        activity.queue.add(runShow);
      } else {
        runShow();
      }
    };
    const suspend = () => {
      stopWaiting();
      if (activity?.scrolling) {
        activity.queue.add(runSuspend);
      } else {
        runSuspend();
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        near = Boolean(entries.at(-1)?.isIntersecting);
        if (suspendOffscreen) {
          stopWaiting();
          if (near) {
            // Skip documents swept past during a fling, and wait until active
            // scrolling settles so iframe initialization never stutters the tail
            // of a momentum scroll gesture.
            timer = setTimeout(scheduleShow, PREVIEW_DWELL_MS);
          } else {
            suspend();
          }
        } else if (near) {
          if (activity?.scrolling) {
            activity.queue.add(() => {
              if (!near) return;
              setVisible(true);
              observer.disconnect();
            });
          } else {
            setVisible(true);
            observer.disconnect();
          }
        } else {
          stopWaiting();
        }
      },
      { root: scroller, rootMargin: suspendOffscreen ? "1200px 0px" : "240px" },
    );
    observer.observe(element);
    if (suspendOffscreen) element.addEventListener("focusout", suspend);
    return () => {
      stopWaiting();
      observer.disconnect();
      element.removeEventListener("focusout", suspend);
      if (scroller && activity) releaseScrollerActivity(scroller, activity);
    };
  }, [suspendOffscreen]);
  return { ref, visible };
}
