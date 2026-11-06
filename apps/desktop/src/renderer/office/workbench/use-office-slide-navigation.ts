import { useEffect, useRef } from "react";

import type { PDFDocumentProxy } from "pdfjs-dist";

interface UseOfficeSlideNavigationContext {
  readonly currentPage: number;
  readonly pdf:
    | {
        document: PDFDocumentProxy;
        version: number;
      }
    | undefined;
}
export function useOfficeSlideNavigation(
  context: UseOfficeSlideNavigationContext,
) {
  const { currentPage, pdf } = context;
  const slides = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = slides.current;
    if (!strip) return;
    const revealCurrentSlide = () =>
      strip
        .querySelector('[aria-pressed="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const observer = new ResizeObserver(revealCurrentSlide);
    observer.observe(strip);
    revealCurrentSlide();
    return () => observer.disconnect();
  }, [currentPage, pdf]);
  return { slides };
}
