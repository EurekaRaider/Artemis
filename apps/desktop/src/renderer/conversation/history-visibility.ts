// One observer and scroll frame per timeline, regardless of turn count.
interface TimelineObservation {
  subscribe(element: Element, notify: (visible: boolean) => void): () => void;
}
const timelines = new WeakMap<Element, TimelineObservation>();
const HISTORY_BUFFER = 1_600;

export function observeHistoryTurn(
  element: Element,
  notify: (visible: boolean) => void,
): () => void {
  const scroller = element.closest(".timeline-scroll");
  if (!scroller || typeof IntersectionObserver === "undefined") {
    notify(true);
    return () => {};
  }
  let timeline = timelines.get(scroller);
  if (!timeline) {
    const listeners = new Map<
      Element,
      { notify: (visible: boolean) => void; visible?: boolean }
    >();
    const pending = new Set<Element>();
    const publish = (target: Element, visible: boolean) => {
      const listener = listeners.get(target);
      if (!listener || listener.visible === visible) return;
      listener.visible = visible;
      listener.notify(visible);
    };
    let frame: number | undefined;
    let previousScrollTop = scroller.scrollTop;
    let jumped = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          pending.delete(entry.target);
          publish(
            entry.target,
            entry.isIntersecting ||
              Boolean(entry.target.querySelector("details[open]")) ||
              entry.target.contains(document.activeElement),
          );
        }
      },
      { root: scroller, rootMargin: `${HISTORY_BUFFER}px 0px` },
    );
    const onScroll = () => {
      jumped ||=
        Math.abs(scroller.scrollTop - previousScrollTop) > HISTORY_BUFFER;
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        // The observer mounts ahead of ordinary scrolling. Only a jump past
        // that buffer or a not-yet-observed turn needs synchronous measurement.
        const targets = jumped ? [...listeners.keys()] : [...pending];
        previousScrollTop = scroller.scrollTop;
        jumped = false;
        if (targets.length === 0) return;
        const bounds = scroller.getBoundingClientRect();
        const visible: Element[] = [];
        for (const target of targets) {
          const rect = target.getBoundingClientRect();
          if (rect.bottom >= bounds.top && rect.top <= bounds.bottom)
            visible.push(target);
        }
        for (const target of visible) publish(target, true);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    timeline = {
      subscribe(target, listener) {
        listeners.set(target, { notify: listener });
        pending.add(target);
        observer.observe(target);
        return () => {
          listeners.delete(target);
          pending.delete(target);
          observer.unobserve(target);
          if (listeners.size === 0) {
            observer.disconnect();
            scroller.removeEventListener("scroll", onScroll);
            if (frame !== undefined) cancelAnimationFrame(frame);
            timelines.delete(scroller);
          }
        };
      },
    };
    timelines.set(scroller, timeline);
  }
  return timeline.subscribe(element, notify);
}
