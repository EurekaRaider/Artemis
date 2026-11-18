import { useEffect, useRef, useState } from "react";

/** Mount expensive readers only when their placeholder approaches the viewport. */
export function usePreviewVisible(suspendOffscreen = false) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scroller = element.closest(".timeline-scroll");
    let maxWait: ReturnType<typeof setTimeout> | undefined;
    let near = false;
    const stopWaiting = () => {
      clearTimeout(timer);
      clearTimeout(maxWait);
      scroller?.removeEventListener("scroll", waitForPause);
    };
    const show = () => {
      stopWaiting();
      setVisible(true);
    };
    const waitForPause = () => {
      clearTimeout(timer);
      timer = setTimeout(show, 100);
    };
    const suspend = () => {
      if (!near && !element.contains(document.activeElement)) setVisible(false);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        near = Boolean(entries.at(-1)?.isIntersecting);
        if (suspendOffscreen) {
          stopWaiting();
          if (near) {
            // Skip documents swept past during a fling, but still show a
            // document that stays in view during slow continuous scrolling.
            scroller?.addEventListener("scroll", waitForPause, {
              passive: true,
            });
            maxWait = setTimeout(show, 450);
            waitForPause();
          } else suspend();
        } else if (near) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: scroller, rootMargin: "240px" },
    );
    observer.observe(element);
    if (suspendOffscreen) element.addEventListener("focusout", suspend);
    return () => {
      stopWaiting();
      observer.disconnect();
      element.removeEventListener("focusout", suspend);
    };
  }, [suspendOffscreen]);
  return { ref, visible };
}
