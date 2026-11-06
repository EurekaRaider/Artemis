import {
  environmentBranchMenuLayout,
  type EnvironmentBranchMenuLayout,
} from "./environment-values.js";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

interface UseEnvironmentDisclosureContext {
  readonly manuallyOpened: RefObject<boolean>;
  readonly openRef: RefObject<boolean>;
  readonly setOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly wantsOpen: import("react").RefObject<
    boolean | undefined | undefined
  >;
  readonly focusOnOpen: RefObject<boolean>;
  readonly checksCloseTimer: import("react").RefObject<
    number | undefined | undefined
  >;
  readonly setChecksOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setBranchOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setBranchQuery: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setBranchMenuPosition: import("react").Dispatch<
    import("react").SetStateAction<EnvironmentBranchMenuLayout | undefined>
  >;
  readonly setCreatingMenuBranch: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setMenuBranchName: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly branchTrigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly checksPopover: import("react").RefObject<HTMLDivElement | null>;
  readonly branchOpen: boolean;
  readonly creatingMenuBranch: boolean;
  readonly branchMenuPosition: EnvironmentBranchMenuLayout | undefined;
  readonly branchSearch: import("react").RefObject<HTMLInputElement | null>;
  readonly commitRequest: number | undefined;
  readonly setGitError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setCommitOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
}
export function useEnvironmentDisclosure(
  context: UseEnvironmentDisclosureContext,
) {
  const {
    manuallyOpened,
    openRef,
    setOpen,
    wantsOpen,
    focusOnOpen,
    checksCloseTimer,
    setChecksOpen,
    setBranchOpen,
    setBranchQuery,
    setBranchMenuPosition,
    setCreatingMenuBranch,
    setMenuBranchName,
    branchTrigger,
    checksPopover,
    branchOpen,
    creatingMenuBranch,
    branchMenuPosition,
    branchSearch,
    commitRequest,
    setGitError,
    setCommitOpen,
  } = context;
  const hidePanel = useCallback(() => {
    manuallyOpened.current = false;
    openRef.current = false;
    setOpen(false);
  }, []);

  const closePanel = useCallback(() => {
    wantsOpen.current = false;
    hidePanel();
  }, [hidePanel]);

  const togglePanel = useCallback(() => {
    openRef.current = !openRef.current;
    manuallyOpened.current = openRef.current;
    wantsOpen.current = openRef.current;
    focusOnOpen.current = openRef.current;
    setOpen(openRef.current);
  }, []);

  const cancelChecksClose = useCallback(() => {
    if (checksCloseTimer.current !== undefined) {
      window.clearTimeout(checksCloseTimer.current);
      checksCloseTimer.current = undefined;
    }
  }, []);

  const closeChecks = useCallback(() => {
    cancelChecksClose();
    setChecksOpen(false);
  }, [cancelChecksClose]);

  const closeBranchMenu = useCallback(() => {
    setBranchOpen(false);
    setBranchQuery("");
    setBranchMenuPosition(undefined);
    setCreatingMenuBranch(false);
    setMenuBranchName("");
  }, []);

  const updateBranchMenuPosition = useCallback(() => {
    const anchor = branchTrigger.current?.getBoundingClientRect();
    if (!anchor) return;
    setBranchMenuPosition(
      environmentBranchMenuLayout(anchor, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, []);

  const showChecks = useCallback(() => {
    cancelChecksClose();
    setChecksOpen(true);
  }, [cancelChecksClose]);

  const showChecksWithFocus = useCallback(() => {
    showChecks();
    window.requestAnimationFrame(() => checksPopover.current?.focus());
  }, [showChecks]);

  const scheduleChecksClose = useCallback(() => {
    cancelChecksClose();
    checksCloseTimer.current = window.setTimeout(() => {
      checksCloseTimer.current = undefined;
      setChecksOpen(false);
    }, 140);
  }, [cancelChecksClose]);

  useLayoutEffect(() => {
    if (!branchOpen) return;
    updateBranchMenuPosition();
    const observer =
      typeof window.ResizeObserver === "function" && branchTrigger.current
        ? new window.ResizeObserver(updateBranchMenuPosition)
        : undefined;
    if (branchTrigger.current) observer?.observe(branchTrigger.current);
    window.addEventListener("resize", updateBranchMenuPosition);
    window.addEventListener("scroll", updateBranchMenuPosition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBranchMenuPosition);
      window.removeEventListener("scroll", updateBranchMenuPosition, true);
    };
  }, [branchOpen, updateBranchMenuPosition]);

  useEffect(() => {
    if (!branchOpen || creatingMenuBranch || !branchMenuPosition) return;
    branchSearch.current?.focus({ preventScroll: true });
  }, [branchMenuPosition, branchOpen, creatingMenuBranch]);

  const lastCommitRequest = useRef(commitRequest);
  useEffect(() => {
    if (lastCommitRequest.current === commitRequest) return;
    lastCommitRequest.current = commitRequest;
    if (!commitRequest) return;
    manuallyOpened.current = true;
    wantsOpen.current = true;
    openRef.current = true;
    setOpen(true);
    setGitError(undefined);
    setCommitOpen(true);
  }, [commitRequest]);
  return {
    hidePanel,
    closePanel,
    togglePanel,
    cancelChecksClose,
    closeChecks,
    closeBranchMenu,
    showChecks,
    showChecksWithFocus,
    scheduleChecksClose,
  };
}
