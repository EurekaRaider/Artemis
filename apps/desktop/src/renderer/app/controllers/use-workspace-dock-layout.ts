import { type ToastContent, type WorkspaceDockDrag } from "../app-types.js";

import {
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";

import type { SettingsSnapshot } from "../../../shared/api.js";

import { type WorkspaceTab } from "../../workspace/workspace-tabs.js";

import {
  workspaceDockWidthAfterKey,
  workspaceDockWidthAfterPointer,
  workspaceDockWidthBounds,
} from "../../workspace/workspace-dock-layout.js";

interface UseWorkspaceDockLayoutContext {
  readonly workspaceContent: import("react").RefObject<HTMLDivElement | null>;
  readonly workspaceDockPersistence: import("react").RefObject<Promise<void>>;
  readonly setWorkspaceDockWidth: import("react").Dispatch<
    import("react").SetStateAction<number | undefined>
  >;
  readonly setRuntimeSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly workspaceDockDrag: import("react").RefObject<
    WorkspaceDockDrag | undefined
  >;
  readonly workspaceDockWidthRef: import("react").RefObject<number | undefined>;
  readonly workspaceDockOpen: boolean;
  readonly workspaceDock: import("react").RefObject<HTMLElement | null>;
  readonly setWorkspaceDockResizing: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly setWorkspaceDockOpen: (update: SetStateAction<boolean>) => void;
  readonly setWorkspaceTabMenuOpen: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly openReviewPanel: () => void;
  readonly activeWorkspaceTab: WorkspaceTab | undefined;
  readonly openTerminalPanel: () => void;
}
export function useWorkspaceDockLayout(context: UseWorkspaceDockLayoutContext) {
  const {
    workspaceContent,
    workspaceDockPersistence,
    setWorkspaceDockWidth,
    setRuntimeSettings,
    setToast,
    workspaceDockDrag,
    workspaceDockWidthRef,
    workspaceDockOpen,
    workspaceDock,
    setWorkspaceDockResizing,
    setWorkspaceDockOpen,
    setWorkspaceTabMenuOpen,
    openReviewPanel,
    activeWorkspaceTab,
    openTerminalPanel,
  } = context;
  const currentWorkspaceDockBounds = useCallback(
    () =>
      workspaceDockWidthBounds(
        workspaceContent.current?.clientWidth ?? window.innerWidth,
        window.innerWidth,
      ),
    [],
  );
  const persistWorkspaceDockWidth = useCallback((width: number) => {
    workspaceDockPersistence.current = workspaceDockPersistence.current.then(
      async () => {
        try {
          const persisted = await window.artemis.setWorkspaceDockWidth(width);
          setWorkspaceDockWidth(persisted);
          setRuntimeSettings((current) =>
            current ? { ...current, workspaceDockWidth: persisted } : current,
          );
        } catch (error) {
          setToast({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return workspaceDockPersistence.current;
  }, []);
  const workspaceDockWidthForPointer = useCallback(
    (clientX: number) => {
      const drag = workspaceDockDrag.current;
      if (!drag) return workspaceDockWidthRef.current;
      return workspaceDockWidthAfterPointer(
        drag.startWidth,
        drag.startX,
        clientX,
        document.documentElement.dir === "rtl" ? "rtl" : "ltr",
        currentWorkspaceDockBounds(),
      );
    },
    [currentWorkspaceDockBounds],
  );
  const beginWorkspaceDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !workspaceDockOpen) return;
      event.preventDefault();
      const startWidth = workspaceDock.current?.getBoundingClientRect().width;
      if (!startWidth) return;
      workspaceDockDrag.current = {
        pointerId: event.pointerId,
        startWidth,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setWorkspaceDockWidth(Math.round(startWidth));
      setWorkspaceDockResizing(true);
    },
    [workspaceDockOpen],
  );
  const moveWorkspaceDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (workspaceDockDrag.current?.pointerId !== event.pointerId) return;
      const width = workspaceDockWidthForPointer(event.clientX);
      if (width !== undefined) setWorkspaceDockWidth(width);
    },
    [workspaceDockWidthForPointer],
  );
  const finishWorkspaceDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (workspaceDockDrag.current?.pointerId !== event.pointerId) return;
      const width = workspaceDockWidthForPointer(event.clientX);
      workspaceDockDrag.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setWorkspaceDockResizing(false);
      if (width !== undefined) {
        setWorkspaceDockWidth(width);
        void persistWorkspaceDockWidth(width);
      }
    },
    [persistWorkspaceDockWidth, workspaceDockWidthForPointer],
  );
  const cancelWorkspaceDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (workspaceDockDrag.current?.pointerId !== event.pointerId) return;
      const width = Math.round(
        workspaceDockWidthRef.current ?? workspaceDockDrag.current.startWidth,
      );
      workspaceDockDrag.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setWorkspaceDockResizing(false);
      setWorkspaceDockWidth(width);
      void persistWorkspaceDockWidth(width);
    },
    [persistWorkspaceDockWidth],
  );
  const resizeWorkspaceDockFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      event.preventDefault();
      const bounds = currentWorkspaceDockBounds();
      const currentWidth =
        workspaceDock.current?.getBoundingClientRect().width ??
        workspaceDockWidthRef.current ??
        bounds.min;
      const step = event.shiftKey ? 64 : 24;
      const width = workspaceDockWidthAfterKey(
        currentWidth,
        event.key,
        document.documentElement.dir === "rtl" ? "rtl" : "ltr",
        bounds,
        workspaceContent.current?.clientWidth ?? window.innerWidth,
        step,
      );
      setWorkspaceDockWidth(width);
      void persistWorkspaceDockWidth(width);
    },
    [currentWorkspaceDockBounds, persistWorkspaceDockWidth],
  );
  const toggleRightSidebar = useCallback(() => {
    setWorkspaceDockOpen((open) => !open);
    setWorkspaceTabMenuOpen(false);
  }, []);
  const toggleReviewPanel = useCallback(() => {
    if (workspaceDockOpen && activeWorkspaceTab?.kind === "review") {
      setWorkspaceDockOpen(false);
    } else {
      openReviewPanel();
    }
  }, [activeWorkspaceTab?.kind, openReviewPanel, workspaceDockOpen]);
  const toggleTerminalPanel = useCallback(() => {
    if (workspaceDockOpen && activeWorkspaceTab?.kind === "terminal") {
      setWorkspaceDockOpen(false);
    } else {
      openTerminalPanel();
    }
  }, [activeWorkspaceTab?.kind, openTerminalPanel, workspaceDockOpen]);
  return {
    beginWorkspaceDockResize,
    moveWorkspaceDockResize,
    finishWorkspaceDockResize,
    cancelWorkspaceDockResize,
    resizeWorkspaceDockFromKeyboard,
    toggleRightSidebar,
    toggleReviewPanel,
    toggleTerminalPanel,
  };
}
