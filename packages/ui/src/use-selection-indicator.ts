import { useLayoutEffect, useRef } from "react";

/** Keep one selection surface aligned with the actual, possibly unequal buttons. */
export function useSelectionIndicator() {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const selected = root.querySelector<HTMLButtonElement>(
        ':scope > button:is([aria-pressed="true"], [aria-checked="true"])',
      );
      if (!selected?.offsetWidth || !selected.offsetHeight) return;
      root.style.setProperty("--selection-x", `${selected.offsetLeft}px`);
      root.style.setProperty("--selection-y", `${selected.offsetTop}px`);
      root.style.setProperty("--selection-width", `${selected.offsetWidth}px`);
      root.style.setProperty(
        "--selection-height",
        `${selected.offsetHeight}px`,
      );
      root.dataset.selectionIndicator = "ready";
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(root);
    for (const button of root.querySelectorAll(":scope > button")) {
      observer.observe(button);
    }
    return () => observer.disconnect();
  });
  return rootRef;
}
