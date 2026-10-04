// One observer and scroll frame per timeline, regardless of turn count.
interface TimelineObservation {
  subscribe(element: Element, notify: (visible: boolean) => void): () => void;
}
const timelines = new WeakMap<Element, TimelineObservation>();

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
    const listeners = new Map<Element, (visible: boolean) => void>();
    let frame: number | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          listeners.get(entry.target)?.(
            entry.isIntersecting ||
              Boolean(entry.target.querySelector("details[open]")) ||
              entry.target.contains(document.activeElement),
          );
        }
      },
      { root: scroller, rootMargin: "1600px 0px" },
    );
    const onScroll = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const bounds = scroller.getBoundingClientRect();
        for (const [target, listener] of listeners) {
          const rect = target.getBoundingClientRect();
          if (rect.bottom >= bounds.top && rect.top <= bounds.bottom)
            listener(true);
        }
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    timeline = {
      subscribe(target, listener) {
        listeners.set(target, listener);
        observer.observe(target);
        return () => {
          listeners.delete(target);
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
