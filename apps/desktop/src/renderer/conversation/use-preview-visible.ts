import { useEffect, useRef, useState } from "react";

/** Mount expensive readers only when their placeholder approaches the viewport. */
export function usePreviewVisible() {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, visible };
}
