import { useCallback, useLayoutEffect, type RefObject } from "react";

interface UseEnvironmentReservationContext {
  readonly control: import("react").RefObject<HTMLDivElement | null>;
  readonly panel: import("react").RefObject<HTMLDivElement | null>;
  readonly manuallyOpened: RefObject<boolean>;
  readonly dockOpen: boolean;
  readonly hasPanelContent: boolean;
  readonly wantsOpen: import("react").RefObject<
    boolean | undefined | undefined
  >;
  readonly defaultOpen: boolean;
  readonly openRef: RefObject<boolean>;
  readonly setOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly reservationActive: boolean;
  readonly hidePanel: () => void;
  readonly panelVisible: boolean;
}
export function useEnvironmentReservation(
  context: UseEnvironmentReservationContext,
) {
  const {
    control,
    panel,
    manuallyOpened,
    dockOpen,
    hasPanelContent,
    wantsOpen,
    defaultOpen,
    openRef,
    setOpen,
    reservationActive,
    hidePanel,
    panelVisible,
  } = context;
  const measureContentSpace = useCallback(() => {
    const workspace = control.current?.closest(".workspace");
    const conversation = workspace?.querySelector<HTMLElement>(".conversation");
    if (!(workspace instanceof HTMLElement) || !conversation) return;
    const bounds = conversation.getBoundingClientRect();
    const workspaceBounds = workspace.getBoundingClientRect();
    if (bounds.width === 0) return;
    const style = window.getComputedStyle(workspace);
    const configuredWidth =
      Number.parseFloat(
        style.getPropertyValue("--environment-panel-inline-size"),
      ) || 304;
    const panelWidth = Math.min(configuredWidth, window.innerWidth - 62);
    const panelBounds = panel.current?.getBoundingClientRect();
    const rtl = style.direction === "rtl";
    const panelStart = panelBounds?.width
      ? rtl
        ? panelBounds.right
        : panelBounds.left
      : rtl
        ? workspaceBounds.left + panelWidth
        : workspaceBounds.right - panelWidth;
    // Measure against the conversation, so a panel above the tool dock
    // reserves nothing when it is already outside the reading area.
    const inset = Math.max(
      0,
      rtl ? panelStart + 24 - bounds.left : bounds.right - panelStart + 24,
    );
    return {
      workspace,
      conversation,
      inset,
      enoughSpace:
        window.innerWidth >= 980 &&
        (inset === 0 || bounds.width - inset - 24 >= 320),
    };
  }, []);

  useLayoutEffect(() => {
    manuallyOpened.current = false;
  }, [dockOpen]);

  useLayoutEffect(() => {
    const workspace = control.current?.closest(".workspace");
    if (!(workspace instanceof HTMLElement)) return;
    const dock = workspace.querySelector<HTMLElement>(
      '[data-artemis-component="workspace-dock"]',
    );
    const syncVisibility = () => {
      const space = measureContentSpace();
      if (!space) return;
      // Content can finish collapsing before the delayed visibility transition.
      const dockStyle = dock && window.getComputedStyle(dock);
      const dockClosed =
        !dock ||
        dockStyle?.visibility === "hidden" ||
        (dock.clientWidth === 0 && dockStyle?.opacity === "0");
      // Preserve explicit opening and menu focus until the reading area
      // becomes too narrow. Dock transitions restore automatic visibility.
      const nextOpen =
        (hasPanelContent || manuallyOpened.current) &&
        (wantsOpen.current ?? defaultOpen) &&
        space.enoughSpace &&
        (manuallyOpened.current || (!dockOpen && dockClosed));
      if (nextOpen === openRef.current) return;
      openRef.current = nextOpen;
      setOpen(nextOpen);
    };
    const observer =
      typeof window.ResizeObserver === "function"
        ? new window.ResizeObserver(syncVisibility)
        : undefined;
    for (const element of [
      workspace,
      control.current,
      workspace.querySelector(".conversation"),
      dock,
    ]) {
      if (element) observer?.observe(element);
    }
    syncVisibility();
    window.addEventListener("resize", syncVisibility);
    dock?.addEventListener("transitionend", syncVisibility);
    dock?.addEventListener("transitioncancel", syncVisibility);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncVisibility);
      dock?.removeEventListener("transitionend", syncVisibility);
      dock?.removeEventListener("transitioncancel", syncVisibility);
    };
  }, [defaultOpen, dockOpen, hasPanelContent, measureContentSpace]);

  useLayoutEffect(() => {
    if (!reservationActive) return;
    const workspace = control.current?.closest(".workspace");
    const conversation = workspace?.querySelector<HTMLElement>(".conversation");
    if (!workspace || !conversation) return;
    const property = "--environment-panel-content-safe-inline-size";
    const durationProperty = "--environment-panel-reservation-duration";
    const reserveSpace = (animate: boolean) => {
      const next = measureContentSpace();
      if (!next) return;
      if (!next.enoughSpace) {
        if (panelVisible) hidePanel();
        next.conversation.style.removeProperty(property);
        next.conversation.style.removeProperty(durationProperty);
        return;
      }
      const value = `${next.inset}px`;
      if (next.conversation.style.getPropertyValue(property) !== value) {
        // Geometry already moves with the dock; a second transition trails it.
        if (!animate) {
          next.conversation.style.setProperty(durationProperty, "0s");
        }
        next.conversation.style.setProperty(property, value);
      }
      const panelBounds = panel.current?.getBoundingClientRect();
      if (panelBounds) {
        const rtl = window.getComputedStyle(next.workspace).direction === "rtl";
        next.conversation.style.setProperty(
          "--computer-preview-top",
          `${panelBounds.top + 12}px`,
        );
        next.conversation.style.setProperty(
          "--computer-preview-inline-end",
          `${Math.max(12, rtl ? panelBounds.right + 12 : window.innerWidth - panelBounds.left + 12)}px`,
        );
      }
    };
    // Prepare the reading area during dock motion, before the panel fades in.
    reserveSpace(panelVisible && manuallyOpened.current);
    const syncGeometry = () => reserveSpace(false);
    const observer =
      typeof window.ResizeObserver === "function"
        ? new window.ResizeObserver(syncGeometry)
        : undefined;
    for (const element of [
      workspace,
      conversation,
      control.current,
      panel.current,
    ]) {
      if (element) observer?.observe(element);
    }
    window.addEventListener("resize", syncGeometry);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncGeometry);
      conversation.style.removeProperty(property);
      conversation.style.removeProperty(durationProperty);
      conversation.style.removeProperty("--computer-preview-top");
      conversation.style.removeProperty("--computer-preview-inline-end");
    };
  }, [hidePanel, measureContentSpace, panelVisible, reservationActive]);
  return {};
}
