import { type ToastContent, type ProjectSidebarDrag } from "../app-types.js";

import {
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";

import type { SettingsSnapshot } from "../../../shared/api.js";

import {
  clampProjectSidebarWidth,
  PROJECT_SIDEBAR_WIDTH_DEFAULT,
} from "../project-sidebar-layout.js";
import {
  createProjectOrderPersistenceQueue,
  type ProjectOrderPersistenceQueue,
} from "../project-order.js";

interface UseProjectLayoutContext {
  readonly projectSidebarPersistence: import("react").RefObject<Promise<void>>;
  readonly setProjectSidebarWidth: import("react").Dispatch<
    import("react").SetStateAction<number | undefined>
  >;
  readonly setRuntimeSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly projectOrderPersistence: import("react").RefObject<
    ProjectOrderPersistenceQueue | undefined
  >;
  readonly projectThreadOrderPersistence: import("react").RefObject<
    Map<string, ProjectOrderPersistenceQueue>
  >;
  readonly projectSidebarDrag: import("react").RefObject<
    ProjectSidebarDrag | undefined
  >;
  readonly projectSidebarWidthRef: import("react").RefObject<
    number | undefined
  >;
  readonly sidebarOpen: boolean;
  readonly projectSidebar: import("react").RefObject<HTMLElement | null>;
  readonly setProjectSidebarResizing: import("react").Dispatch<
    SetStateAction<boolean>
  >;
}
export function useProjectLayout(context: UseProjectLayoutContext) {
  const {
    projectSidebarPersistence,
    setProjectSidebarWidth,
    setRuntimeSettings,
    setToast,
    projectOrderPersistence,
    projectThreadOrderPersistence,
    projectSidebarDrag,
    projectSidebarWidthRef,
    sidebarOpen,
    projectSidebar,
    setProjectSidebarResizing,
  } = context;
  const persistProjectSidebarWidth = useCallback((width: number) => {
    projectSidebarPersistence.current = projectSidebarPersistence.current.then(
      async () => {
        try {
          const persisted = await window.artemis.setProjectSidebarWidth(width);
          setProjectSidebarWidth(persisted);
          setRuntimeSettings((current) =>
            current ? { ...current, projectSidebarWidth: persisted } : current,
          );
        } catch (error) {
          setToast({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return projectSidebarPersistence.current;
  }, []);
  const persistProjectOrder = useCallback(
    (order: string[], previousOrder: string[]) => {
      setRuntimeSettings((current) =>
        current ? { ...current, projectOrder: order } : current,
      );
      return projectOrderPersistence.current?.persist(order, previousOrder);
    },
    [],
  );
  const persistProjectThreadOrder = useCallback(
    (projectId: string, order: string[], previousOrder: string[]) => {
      const applyOrder = (
        current: SettingsSnapshot | undefined,
        value: string[],
      ) =>
        current
          ? {
              ...current,
              projectThreadOrder: {
                ...(current.projectThreadOrder ?? {}),
                [projectId]: value,
              },
            }
          : current;
      let persistence = projectThreadOrderPersistence.current.get(projectId);
      if (!persistence) {
        persistence = createProjectOrderPersistenceQueue({
          save: (value) =>
            window.artemis.setProjectThreadOrder(projectId, value),
          onPersisted: (value) => {
            setRuntimeSettings((current) => applyOrder(current, value));
          },
          onRejected: (value, error) => {
            setRuntimeSettings((current) => applyOrder(current, value));
            setToast({
              error: true,
              message: error instanceof Error ? error.message : String(error),
            });
          },
        });
        projectThreadOrderPersistence.current.set(projectId, persistence);
      }
      setRuntimeSettings((current) => applyOrder(current, order));
      return persistence.persist(order, previousOrder);
    },
    [],
  );
  const projectSidebarWidthForPointer = useCallback((clientX: number) => {
    const drag = projectSidebarDrag.current;
    if (!drag) return projectSidebarWidthRef.current;
    const delta =
      document.documentElement.dir === "rtl"
        ? drag.startX - clientX
        : clientX - drag.startX;
    return clampProjectSidebarWidth(drag.startWidth + delta);
  }, []);
  const beginProjectSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!sidebarOpen || event.button !== 0) return;
      const startWidth =
        projectSidebar.current?.getBoundingClientRect().width ??
        projectSidebarWidthRef.current ??
        PROJECT_SIDEBAR_WIDTH_DEFAULT;
      projectSidebarDrag.current = {
        pointerId: event.pointerId,
        startWidth,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setProjectSidebarWidth(Math.round(startWidth));
      setProjectSidebarResizing(true);
    },
    [sidebarOpen],
  );
  const moveProjectSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (projectSidebarDrag.current?.pointerId !== event.pointerId) return;
      const width = projectSidebarWidthForPointer(event.clientX);
      if (width !== undefined) setProjectSidebarWidth(width);
    },
    [projectSidebarWidthForPointer],
  );
  const finishProjectSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (projectSidebarDrag.current?.pointerId !== event.pointerId) return;
      const width = projectSidebarWidthForPointer(event.clientX);
      projectSidebarDrag.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setProjectSidebarResizing(false);
      if (width !== undefined) {
        setProjectSidebarWidth(width);
        void persistProjectSidebarWidth(width);
      }
    },
    [persistProjectSidebarWidth, projectSidebarWidthForPointer],
  );
  const cancelProjectSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = projectSidebarDrag.current;
      if (drag?.pointerId !== event.pointerId) return;
      projectSidebarDrag.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setProjectSidebarResizing(false);
      setProjectSidebarWidth(clampProjectSidebarWidth(drag.startWidth));
    },
    [],
  );
  const resizeProjectSidebarFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const currentWidth =
        projectSidebar.current?.getBoundingClientRect().width ??
        projectSidebarWidthRef.current ??
        PROJECT_SIDEBAR_WIDTH_DEFAULT;
      const logicalIncrease =
        document.documentElement.dir === "rtl"
          ? event.key === "ArrowLeft"
          : event.key === "ArrowRight";
      const width = clampProjectSidebarWidth(
        currentWidth + (logicalIncrease ? 24 : -24),
      );
      setProjectSidebarWidth(width);
      void persistProjectSidebarWidth(width);
    },
    [persistProjectSidebarWidth],
  );
  return {
    persistProjectOrder,
    persistProjectThreadOrder,
    beginProjectSidebarResize,
    moveProjectSidebarResize,
    finishProjectSidebarResize,
    cancelProjectSidebarResize,
    resizeProjectSidebarFromKeyboard,
  };
}
