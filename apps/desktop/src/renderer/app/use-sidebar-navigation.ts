import { useCallback, useEffect, useRef, useState } from "react";

import { booleanUiState, usePersistentUiState } from "./ui-state.js";

import type { RefObject } from "react";
export function useSidebarNavigation(
  projectSidebar: RefObject<HTMLElement | null>,
) {
  const [sidebarOpen, setSidebarOpen] = usePersistentUiState(
    "artemis-sidebar-open",
    booleanUiState,
    () => window.innerWidth > 1060,
  );
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const sidebarHoverSuppressed = useRef(false);
  const sidebarPeekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const sidebarAnimationTimer = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const closeSidebarPeek = useCallback(() => {
    clearTimeout(sidebarPeekTimer.current);
    sidebarPeekTimer.current = undefined;
    setSidebarPeek(false);
  }, []);
  const requestSidebarPeek = () => {
    if (
      sidebarOpen ||
      sidebarHoverSuppressed.current ||
      sidebarPeek ||
      sidebarPeekTimer.current !== undefined
    )
      return;
    // Both visible surfaces and their inert state switch after the same debounce.
    sidebarPeekTimer.current = setTimeout(() => {
      sidebarPeekTimer.current = undefined;
      setSidebarPeek(true);
    }, 200);
  };
  useEffect(() => {
    const releaseHover = () => {
      sidebarHoverSuppressed.current = false;
    };
    window.addEventListener("mousemove", releaseHover);
    return () => {
      window.removeEventListener("mousemove", releaseHover);
      clearTimeout(sidebarPeekTimer.current);
      clearTimeout(sidebarAnimationTimer.current);
    };
  }, []);
  const changeSidebarOpen = useCallback(
    (open: boolean | ((current: boolean) => boolean)) => {
      const restoreFocus =
        projectSidebar.current?.contains(document.activeElement) ||
        document.activeElement?.classList.contains("left-sidebar-toggle");
      closeSidebarPeek();
      sidebarHoverSuppressed.current = true;
      clearTimeout(sidebarAnimationTimer.current);
      setSidebarAnimating(true);
      setSidebarOpen(open);
      sidebarAnimationTimer.current = setTimeout(
        () => setSidebarAnimating(false),
        400,
      );
      // The rail remains available after the main navigation becomes inert.
      requestAnimationFrame(() => {
        if (!restoreFocus) return;
        const collapsed =
          projectSidebar.current?.getAttribute("data-state") === "collapsed";
        projectSidebar.current
          ?.querySelector<HTMLButtonElement>(
            collapsed ? ".rail-brand" : ".sidebar-collapse",
          )
          ?.focus({ preventScroll: true });
      });
    },
    [closeSidebarPeek],
  );

  return {
    sidebarOpen,
    sidebarPeek,
    sidebarHoverSuppressed,
    sidebarAnimating,
    closeSidebarPeek,
    requestSidebarPeek,
    changeSidebarOpen,
  };
}
