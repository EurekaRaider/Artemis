import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const measuredHeights = new Map<string, number>();

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
  const height = useRef(measuredHeights.get(cacheKey) ?? 180);
  const [visible, setVisible] = useState(initialVisible || active);
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
      { root: element.closest(".timeline-scroll"), rootMargin: "800px 0px" },
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
      height.current = element.getBoundingClientRect().height || height.current;
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
