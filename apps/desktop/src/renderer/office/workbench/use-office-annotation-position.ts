import { useEffect } from "react";

interface UseOfficeAnnotationPositionContext {
  readonly annotationOpen: boolean;
  readonly stage: import("react").RefObject<HTMLDivElement | null>;
  readonly annotationPanel: import("react").RefObject<HTMLElement | null>;
  readonly setPosition: import("react").Dispatch<
    import("react").SetStateAction<{ x: number; y: number } | undefined>
  >;
}
export function useOfficeAnnotationPosition(
  context: UseOfficeAnnotationPositionContext,
) {
  const { annotationOpen, stage, annotationPanel, setPosition } = context;
  useEffect(() => {
    if (!annotationOpen || !stage.current || !annotationPanel.current) return;
    const observer = new ResizeObserver(() => {
      setPosition((previous) => {
        if (!previous || !stage.current || !annotationPanel.current)
          return previous;
        const x = Math.max(
          0,
          Math.min(
            previous.x,
            stage.current.clientWidth - annotationPanel.current.offsetWidth,
          ),
        );
        const y = Math.max(
          0,
          Math.min(
            previous.y,
            stage.current.clientHeight - annotationPanel.current.offsetHeight,
          ),
        );
        return x === previous.x && y === previous.y ? previous : { x, y };
      });
    });
    observer.observe(stage.current);
    observer.observe(annotationPanel.current);
    return () => observer.disconnect();
  }, [annotationOpen]);
  return {};
}
