import { useEffect, type RefObject } from "react";

import type { ProjectPullRequestLookup } from "../../../shared/api.js";

interface UseEnvironmentDismissalContext {
  readonly defaultOpen: boolean;
  readonly openRef: RefObject<boolean>;
  readonly project: {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    updatedAt: string;
  };
  readonly threadId: string | undefined;
  readonly loadGit: () => Promise<void>;
  readonly loadPullRequest: () => Promise<void>;
  readonly open: boolean;
  readonly panel: import("react").RefObject<HTMLDivElement | null>;
  readonly focusOnOpen: RefObject<boolean>;
  readonly pullRequestLookup: ProjectPullRequestLookup | undefined;
  readonly cancelChecksClose: () => void;
  readonly branchOpen: boolean;
  readonly branchTrigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly branchMenu: import("react").RefObject<HTMLDivElement | null>;
  readonly closeBranchMenu: () => void;
  readonly commitOpen: boolean;
  readonly closePanel: () => void;
  readonly trigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly setCreatingMenuBranch: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setMenuBranchName: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setGitError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly creatingMenuBranch: boolean;
  readonly setCommitOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setCreatingCommitBranch: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setCommitMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly closeChecks: () => void;
  readonly checksTrigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly checksOpen: boolean;
}
export function useEnvironmentDismissal(
  context: UseEnvironmentDismissalContext,
) {
  const {
    defaultOpen,
    openRef,
    project,
    threadId,
    loadGit,
    loadPullRequest,
    open,
    panel,
    focusOnOpen,
    pullRequestLookup,
    cancelChecksClose,
    branchOpen,
    branchTrigger,
    branchMenu,
    closeBranchMenu,
    commitOpen,
    closePanel,
    trigger,
    setCreatingMenuBranch,
    setMenuBranchName,
    setGitError,
    creatingMenuBranch,
    setCommitOpen,
    setCreatingCommitBranch,
    setCommitMessage,
    closeChecks,
    checksTrigger,
    checksOpen,
  } = context;
  useEffect(
    () =>
      window.artemis.onProjectGitChanged((context) => {
        if (
          (!defaultOpen && !openRef.current) ||
          context.projectId !== project.id ||
          context.threadId !== threadId
        ) {
          return;
        }
        void loadGit();
        if (openRef.current) void loadPullRequest();
      }),
    [defaultOpen, loadGit, loadPullRequest, project.id, threadId],
  );

  useEffect(() => {
    if (!open) return;
    const refreshOnFocus = () => {
      void loadGit();
      void loadPullRequest();
    };
    window.addEventListener("focus", refreshOnFocus);
    const frame = focusOnOpen.current
      ? window.requestAnimationFrame(() => panel.current?.focus())
      : undefined;
    focusOnOpen.current = false;
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadGit, loadPullRequest, open]);

  useEffect(() => {
    if (
      !open ||
      pullRequestLookup?.status !== "found" ||
      pullRequestLookup.pullRequest.state !== "OPEN" ||
      !pullRequestLookup.pullRequest.checks.some(
        (check) => check.status === "pending",
      )
    ) {
      return;
    }
    const interval = window.setInterval(() => void loadPullRequest(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadPullRequest, open, pullRequestLookup]);

  useEffect(
    () => () => {
      cancelChecksClose();
    },
    [cancelChecksClose],
  );

  useEffect(() => {
    if (!branchOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        branchTrigger.current?.contains(target) ||
        branchMenu.current?.contains(target)
      ) {
        return;
      }
      closeBranchMenu();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeOutside, true);
  }, [branchOpen, closeBranchMenu]);

  useEffect(() => {
    if (!open && !commitOpen) return;
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (checksOpen) {
        closeChecks();
        checksTrigger.current?.focus();
      } else if (commitOpen) {
        setCommitOpen(false);
        setCreatingCommitBranch(false);
        setCommitMessage("");
      } else if (creatingMenuBranch) {
        setCreatingMenuBranch(false);
        setMenuBranchName("");
        setGitError(undefined);
      } else if (branchOpen) {
        closeBranchMenu();
      } else {
        closePanel();
        window.requestAnimationFrame(() => trigger.current?.focus());
      }
    };
    window.addEventListener("keydown", closeEscape);
    return () => window.removeEventListener("keydown", closeEscape);
  }, [
    branchOpen,
    checksOpen,
    closeChecks,
    closeBranchMenu,
    closePanel,
    commitOpen,
    creatingMenuBranch,
    open,
  ]);
  return {};
}
