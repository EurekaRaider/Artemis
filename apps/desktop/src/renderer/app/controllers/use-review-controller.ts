import { appCopy } from "../app-copy.js";
import {
  type ConfirmationTone,
  type ToastContent,
  type ConfirmationState,
} from "../app-types.js";

import { useCallback, useEffect, type SetStateAction } from "react";

import { reduceAgentEvents } from "@artemis/protocol";
import type {
  ReviewAction,
  ReviewComment,
  ReviewDiff,
  ReviewScope,
} from "../../../shared/api.js";

import { type WorkspaceTab } from "../../workspace/workspace-tabs.js";

interface UseReviewControllerContext {
  readonly reviewScopeThreadId: import("react").RefObject<string | undefined>;
  readonly activeThreadId: string | undefined;
  readonly reviewRequestId: import("react").RefObject<number>;
  readonly setReviewScope: import("react").Dispatch<
    import("react").SetStateAction<ReviewScope>
  >;
  readonly setReviewTurnId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setReviewDiff: import("react").Dispatch<
    import("react").SetStateAction<ReviewDiff | undefined>
  >;
  readonly setSelectedReviewFilePath: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setCommentLineId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setCommentBody: import("react").Dispatch<SetStateAction<string>>;
  readonly threadState: ReturnType<typeof reduceAgentEvents> | undefined;
  readonly reviewScope: ReviewScope;
  readonly reviewBaseRef: string;
  readonly reviewTurnId: string | undefined;
  readonly reviewDiffVersion: import("react").RefObject<Map<string, number>>;
  readonly reviewDiffCache: import("react").RefObject<Map<string, ReviewDiff>>;
  readonly reviewDiffInFlight: import("react").RefObject<
    Map<string, Promise<ReviewDiff>>
  >;
  readonly setReviewComments: import("react").Dispatch<
    import("react").SetStateAction<ReviewComment[]>
  >;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly startReviewTransition: import("react").TransitionStartFunction;
  readonly setReviewBaseRef: import("react").Dispatch<SetStateAction<string>>;
  readonly openReviewPanel: () => Promise<string | undefined> | undefined;
  readonly t: ReturnType<typeof appCopy>;
  readonly requestConfirmation: (
    message: string,
    tone?: ConfirmationTone,
    options?: Pick<ConfirmationState, "acceptLabel" | "cancelLabel" | "title">,
  ) => Promise<boolean>;
  readonly workspaceDockOpen: boolean;
  readonly activeWorkspaceTab: WorkspaceTab | undefined;
  readonly activeProject: import("@artemis/protocol").Project | undefined;
  readonly setReviewCounts: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          threadId: string;
          staged?: number;
          unstaged?: number;
        }
      | undefined
    >
  >;
  readonly reviewDiff: ReviewDiff | undefined;
  readonly reviewCounts:
    | {
        threadId: string;
        staged?: number;
        unstaged?: number;
      }
    | undefined;
  readonly reviewBusy: boolean;
  readonly setReviewBusy: import("react").Dispatch<SetStateAction<boolean>>;
  readonly commentBody: string;
}
export function useReviewController(context: UseReviewControllerContext) {
  const {
    reviewScopeThreadId,
    activeThreadId,
    reviewRequestId,
    setReviewScope,
    setReviewTurnId,
    setReviewDiff,
    setSelectedReviewFilePath,
    setCommentLineId,
    setCommentBody,
    threadState,
    reviewScope,
    reviewBaseRef,
    reviewTurnId,
    reviewDiffVersion,
    reviewDiffCache,
    reviewDiffInFlight,
    setReviewComments,
    setToast,
    startReviewTransition,
    setReviewBaseRef,
    openReviewPanel,
    t,
    requestConfirmation,
    workspaceDockOpen,
    activeWorkspaceTab,
    activeProject,
    setReviewCounts,
    reviewDiff,
    reviewCounts,
    reviewBusy,
    setReviewBusy,
    commentBody,
  } = context;
  const resetThreadReview = (
    threadId: string | undefined,
    scope: ReviewScope,
  ) => {
    reviewScopeThreadId.current = threadId;
    reviewRequestId.current += 1;
    setReviewScope(scope);
    setReviewTurnId(undefined);
    setReviewDiff(undefined);
    setSelectedReviewFilePath(undefined);
    setCommentLineId(undefined);
    setCommentBody("");
  };
  useEffect(() => {
    if (reviewScopeThreadId.current !== activeThreadId) {
      resetThreadReview(activeThreadId, "branch");
    }
  }, [activeThreadId]);

  // Completed turn diffs are immutable; live output must not reload them.
  const reviewLiveSequence =
    reviewScope === "turn" ? 0 : (threadState?.lastSeq ?? 0);
  const reviewChangedFileCount =
    reviewScope === "turn" ? 0 : (threadState?.changedFiles.length ?? 0);
  const reviewDiffCacheKey = useCallback(
    (threadId: string, scope: ReviewScope) => {
      const baseRef = scope === "branch" ? reviewBaseRef.trim() : "";
      const turnId = scope === "turn" ? (reviewTurnId ?? "") : "";
      const version = reviewDiffVersion.current.get(threadId) ?? 0;
      const sequence = scope === "turn" ? 0 : reviewLiveSequence;
      return `${threadId}\u0000${scope}\u0000${turnId}\u0000${baseRef}\u0000${sequence}\u0000${version}`;
    },
    [reviewBaseRef, reviewTurnId, reviewLiveSequence],
  );

  const loadCachedReviewDiff = useCallback(
    (threadId: string, scope: ReviewScope, force = false) => {
      const cacheKey = reviewDiffCacheKey(threadId, scope);
      const cached = reviewDiffCache.current.get(cacheKey);
      if (!force && cached) return Promise.resolve(cached);
      const inFlight = reviewDiffInFlight.current.get(cacheKey);
      if (inFlight) return inFlight;

      const request = window.artemis
        .getReviewDiff({
          threadId,
          scope,
          ...(scope === "turn" && reviewTurnId ? { turnId: reviewTurnId } : {}),
          ...(scope === "branch" && reviewBaseRef.trim()
            ? { baseRef: reviewBaseRef.trim() }
            : {}),
        })
        .then((diff) => {
          reviewDiffCache.current.set(cacheKey, diff);
          if (reviewDiffCache.current.size > 16) {
            const oldestKey = reviewDiffCache.current.keys().next().value;
            if (oldestKey) reviewDiffCache.current.delete(oldestKey);
          }
          return diff;
        })
        .finally(() => {
          reviewDiffInFlight.current.delete(cacheKey);
        });
      reviewDiffInFlight.current.set(cacheKey, request);
      return request;
    },
    [reviewBaseRef, reviewDiffCacheKey, reviewTurnId],
  );

  const invalidateReviewDiffCache = useCallback((threadId: string) => {
    reviewDiffVersion.current.set(
      threadId,
      (reviewDiffVersion.current.get(threadId) ?? 0) + 1,
    );
    const prefix = `${threadId}\u0000`;
    for (const key of reviewDiffCache.current.keys()) {
      if (key.startsWith(prefix)) reviewDiffCache.current.delete(key);
    }
  }, []);

  const refreshDiff = useCallback(
    async (force = false) => {
      const requestId = ++reviewRequestId.current;
      if (!activeThreadId) {
        setReviewDiff({
          available: true,
          scope: reviewScope,
          text: "",
          files: [],
        });
        setReviewComments([]);
        return;
      }

      void window.artemis
        .listReviewComments(activeThreadId)
        .then((comments) => {
          if (requestId !== reviewRequestId.current) return;
          setReviewComments(comments);
        })
        .catch((error) => {
          if (requestId !== reviewRequestId.current) return;
          setToast(error instanceof Error ? error.message : String(error));
        });

      try {
        const diff = await loadCachedReviewDiff(
          activeThreadId,
          reviewScope,
          force,
        );
        if (requestId !== reviewRequestId.current) return;
        startReviewTransition(() => {
          setReviewDiff(diff);
        });
        return diff;
      } catch (error) {
        if (requestId !== reviewRequestId.current) return;
        setReviewDiff({
          available: false,
          scope: reviewScope,
          text: "",
          files: [],
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeThreadId, loadCachedReviewDiff, reviewScope],
  );

  const selectReviewScope = (scope: ReviewScope) => {
    if (scope === reviewScope) return;
    reviewRequestId.current += 1;
    setReviewScope(scope);
    if (scope !== "turn") setReviewTurnId(undefined);
    const cached = activeThreadId
      ? reviewDiffCache.current.get(reviewDiffCacheKey(activeThreadId, scope))
      : undefined;
    setReviewDiff(cached);
    setSelectedReviewFilePath(undefined);
    setCommentLineId(undefined);
    setCommentBody("");
  };

  const openReviewScopePanel = async (scope: ReviewScope, baseRef?: string) => {
    if (scope === "branch" && baseRef) setReviewBaseRef(baseRef);
    if (!activeThreadId) {
      const threadId = await openReviewPanel();
      if (threadId && scope !== "branch") {
        // The welcome card opens a workspace draft. Keep its requested scope
        // across that thread's normal reset to branch comparison.
        invalidateReviewDiffCache(threadId);
        resetThreadReview(threadId, scope);
      }
      return;
    }
    invalidateReviewDiffCache(activeThreadId);
    selectReviewScope(scope);
    if (
      scope === reviewScope &&
      workspaceDockOpen &&
      activeWorkspaceTab?.kind === "review" &&
      (scope !== "branch" || !baseRef || baseRef === reviewBaseRef)
    ) {
      void refreshDiff(true);
    }
    void openReviewPanel();
  };

  const openReviewTurnPanel = useCallback(
    (turnId: string, path?: string) => {
      if (reviewScope !== "turn" || reviewTurnId !== turnId) {
        reviewRequestId.current += 1;
        setReviewDiff(undefined);
      }
      setReviewTurnId(turnId);
      setReviewScope("turn");
      setSelectedReviewFilePath(path);
      setCommentLineId(undefined);
      setCommentBody("");
      openReviewPanel();
    },
    [openReviewPanel, reviewScope, reviewTurnId],
  );

  const undoTurnChanges = useCallback(
    async (turnId: string) => {
      if (
        !activeThreadId ||
        !(await requestConfirmation(t.undoTurnConfirm, "danger"))
      ) {
        return;
      }
      try {
        const result = await window.artemis.undoTurnChanges(
          activeThreadId,
          turnId,
        );
        invalidateReviewDiffCache(activeThreadId);
        setToast(
          `${t.undoTurnComplete} · ${result.restoredFiles.length} · ${result.recoveryPath}`,
        );
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      }
    },
    [
      activeThreadId,
      invalidateReviewDiffCache,
      requestConfirmation,
      t.undoTurnComplete,
      t.undoTurnConfirm,
    ],
  );

  useEffect(() => {
    if (workspaceDockOpen && activeWorkspaceTab?.kind === "review") {
      void refreshDiff();
    }
  }, [
    activeWorkspaceTab?.kind,
    refreshDiff,
    reviewChangedFileCount,
    workspaceDockOpen,
  ]);

  useEffect(() => {
    if (
      !activeThreadId ||
      !activeProject ||
      !workspaceDockOpen ||
      activeWorkspaceTab?.kind !== "review"
    )
      return;
    let active = true;
    void window.artemis
      .getProjectGitInfo(activeProject.id, activeThreadId)
      .then((info) => {
        if (active)
          setReviewCounts({
            threadId: activeThreadId,
            staged: info.stagedCount,
            unstaged: info.unstagedCount + info.untrackedCount,
          });
      })
      .catch(() => {
        if (active) setReviewCounts(undefined);
      });
    return () => {
      active = false;
    };
  }, [
    activeThreadId,
    activeProject?.id,
    workspaceDockOpen,
    activeWorkspaceTab?.kind,
    reviewDiff,
  ]);
  const reviewCount = (scope: ReviewScope) =>
    reviewDiff?.scope === scope && reviewDiff.available
      ? reviewDiff.files.length
      : reviewCounts?.threadId === activeThreadId &&
          (scope === "staged" || scope === "unstaged")
        ? reviewCounts?.[scope]
        : undefined;

  const mutateReview = useCallback(
    async (
      action: ReviewAction,
      target: { kind: "file" | "hunk"; id: string },
    ) => {
      if (!activeThreadId || reviewBusy) return;
      if (
        action === "revert" &&
        !(await requestConfirmation(t.revertConfirm, "danger"))
      )
        return;
      setReviewBusy(true);
      try {
        const result = await window.artemis.mutateReviewDiff({
          threadId: activeThreadId,
          scope: reviewScope,
          action,
          target:
            target.kind === "file"
              ? { kind: "file", id: target.id }
              : { kind: "hunk", id: target.id },
          ...(reviewScope === "branch" && reviewBaseRef.trim()
            ? { baseRef: reviewBaseRef.trim() }
            : {}),
        });
        if (result.recoveryPath) {
          setToast(`${t.recoverySaved}: ${result.recoveryPath}`);
        }
        invalidateReviewDiffCache(activeThreadId);
        await refreshDiff(true);
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      } finally {
        setReviewBusy(false);
      }
    },
    [
      activeThreadId,
      invalidateReviewDiffCache,
      refreshDiff,
      requestConfirmation,
      reviewBaseRef,
      reviewBusy,
      reviewScope,
      t.recoverySaved,
      t.revertConfirm,
    ],
  );

  const saveReviewComment = useCallback(
    async (lineId: string) => {
      if (
        !activeThreadId ||
        reviewScope === "turn" ||
        !commentBody.trim() ||
        reviewBusy
      )
        return;
      setReviewBusy(true);
      try {
        const comment = await window.artemis.addReviewComment({
          threadId: activeThreadId,
          scope: reviewScope,
          lineId,
          body: commentBody.trim(),
          ...(reviewScope === "branch" && reviewBaseRef.trim()
            ? { baseRef: reviewBaseRef.trim() }
            : {}),
        });
        setReviewComments((current) => [...current, comment]);
        setCommentLineId(undefined);
        setCommentBody("");
        return comment;
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      } finally {
        setReviewBusy(false);
      }
    },
    [activeThreadId, commentBody, reviewBaseRef, reviewBusy, reviewScope],
  );

  const deleteReviewComment = useCallback(
    async (comment: ReviewComment) => {
      if (!activeThreadId || reviewBusy) return;
      setReviewBusy(true);
      try {
        await window.artemis.deleteReviewComment(activeThreadId, comment.id);
        setReviewComments((current) =>
          current.filter((candidate) => candidate.id !== comment.id),
        );
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      } finally {
        setReviewBusy(false);
      }
    },
    [activeThreadId, reviewBusy],
  );
  return {
    refreshDiff,
    selectReviewScope,
    openReviewScopePanel,
    openReviewTurnPanel,
    undoTurnChanges,
    reviewCount,
    mutateReview,
    saveReviewComment,
    deleteReviewComment,
  };
}
