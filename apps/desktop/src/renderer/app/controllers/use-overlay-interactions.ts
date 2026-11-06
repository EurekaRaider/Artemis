import {
  TOAST_VISIBLE_MILLISECONDS,
  TOAST_FADE_MILLISECONDS,
} from "./controller-values.js";
import {
  type ConfirmationTone,
  type ToastState,
  type ConfirmationState,
} from "../app-types.js";

import { useCallback, useEffect, type SetStateAction } from "react";

interface UseOverlayInteractionsContext {
  readonly confirmationResolver: import("react").RefObject<
    ((confirmed: boolean) => void) | undefined
  >;
  readonly setConfirmation: import("react").Dispatch<
    import("react").SetStateAction<ConfirmationState | undefined>
  >;
  readonly toast: ToastState | undefined;
  readonly setToastState: import("react").Dispatch<
    import("react").SetStateAction<ToastState | undefined>
  >;
  readonly approvalMenuOpen: boolean;
  readonly setApprovalMenuOpen: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly approvalPolicyRoot: import("react").RefObject<HTMLDivElement | null>;
  readonly modelPickerOpen: boolean;
  readonly setModelPickerOpen: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly modelPickerRoot: import("react").RefObject<HTMLDivElement | null>;
  readonly projectMenuId: string | undefined;
  readonly threadMenuId: string | undefined;
  readonly setProjectMenuId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setThreadMenuId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
}
export function useOverlayInteractions(context: UseOverlayInteractionsContext) {
  const {
    confirmationResolver,
    setConfirmation,
    toast,
    setToastState,
    approvalMenuOpen,
    setApprovalMenuOpen,
    approvalPolicyRoot,
    modelPickerOpen,
    setModelPickerOpen,
    modelPickerRoot,
    projectMenuId,
    threadMenuId,
    setProjectMenuId,
    setThreadMenuId,
  } = context;
  const requestConfirmation = useCallback(
    (
      message: string,
      tone: ConfirmationTone = "default",
      options: Pick<
        ConfirmationState,
        "acceptLabel" | "cancelLabel" | "title"
      > = {},
    ) =>
      new Promise<boolean>((resolve) => {
        confirmationResolver.current?.(false);
        confirmationResolver.current = resolve;
        setConfirmation({ message, tone, ...options });
      }),
    [],
  );

  const resolveConfirmation = useCallback((confirmed: boolean) => {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = undefined;
    setConfirmation(undefined);
    resolve?.(confirmed);
  }, []);

  useEffect(
    () => () => {
      confirmationResolver.current?.(false);
      confirmationResolver.current = undefined;
    },
    [],
  );

  const activeToastId = toast?.id;
  useEffect(() => {
    if (activeToastId === undefined) return;
    const fadeTimer = window.setTimeout(() => {
      setToastState((current) =>
        current?.id === activeToastId ? { ...current, fading: true } : current,
      );
    }, TOAST_VISIBLE_MILLISECONDS);
    const removeTimer = window.setTimeout(() => {
      setToastState((current) =>
        current?.id === activeToastId ? undefined : current,
      );
    }, TOAST_VISIBLE_MILLISECONDS + TOAST_FADE_MILLISECONDS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [activeToastId]);

  useEffect(() => {
    if (!approvalMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!approvalPolicyRoot.current?.contains(event.target as Node)) {
        setApprovalMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [approvalMenuOpen]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!modelPickerRoot.current?.contains(event.target as Node)) {
        setModelPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [modelPickerOpen]);

  useEffect(() => {
    if (!projectMenuId && !threadMenuId) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          ".project-menu, .thread-menu, .project-action, .thread-action",
        )
      ) {
        return;
      }
      setProjectMenuId(undefined);
      setThreadMenuId(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProjectMenuId(undefined);
      setThreadMenuId(undefined);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [projectMenuId, threadMenuId]);
  return { requestConfirmation, resolveConfirmation };
}
