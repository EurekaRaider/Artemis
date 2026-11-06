import type { EnvironmentBranchMenuLayout } from "./environment-values.js";
import { suggestedEnvironmentBranchName } from "./environment-values.js";

import { useCallback, useEffect, type RefObject } from "react";

import type {
  ProjectGitInfo,
  ProjectPullRequestLookup,
  ReviewScope,
  ReviewFile,
} from "../../../shared/api.js";

interface UseEnvironmentGitSubscriptionsContext {
  readonly gitRequest: RefObject<number>;
  readonly setGitError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly project: {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    updatedAt: string;
  };
  readonly threadId: string | undefined;
  readonly setGitInfo: import("react").Dispatch<
    import("react").SetStateAction<ProjectGitInfo | undefined>
  >;
  readonly setChangedFiles: import("react").Dispatch<
    import("react").SetStateAction<Array<ReviewFile & { scope: ReviewScope }>>
  >;
  readonly setChangesError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly open: boolean;
  readonly gitInfo: ProjectGitInfo | undefined;
  readonly pullRequestRequest: RefObject<number>;
  readonly setPullRequestLoading: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setPullRequestError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setPullRequestLookup: import("react").Dispatch<
    import("react").SetStateAction<ProjectPullRequestLookup | undefined>
  >;
  readonly setChecksOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setCommitOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setCommitMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setIncludeUnstaged: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setCreatingCommitBranch: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly taskTitle: string;
  readonly setNewCommitBranch: import("react").Dispatch<
    import("react").SetStateAction<string>
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
  readonly setPendingSwitchBranch: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly closeBranchMenu: () => void;
  readonly defaultOpen: boolean;
  readonly refreshKey: string | undefined;
  readonly workspaceIsWorktree: boolean | undefined;
}
export function useEnvironmentGitSubscriptions(
  context: UseEnvironmentGitSubscriptionsContext,
) {
  const {
    gitRequest,
    setGitError,
    project,
    threadId,
    setGitInfo,
    setChangedFiles,
    setChangesError,
    open,
    gitInfo,
    pullRequestRequest,
    setPullRequestLoading,
    setPullRequestError,
    setPullRequestLookup,
    setChecksOpen,
    setCommitOpen,
    setCommitMessage,
    setIncludeUnstaged,
    setCreatingCommitBranch,
    taskTitle,
    setNewCommitBranch,
    setBranchOpen,
    setBranchQuery,
    setBranchMenuPosition,
    setCreatingMenuBranch,
    setMenuBranchName,
    setPendingSwitchBranch,
    closeBranchMenu,
    defaultOpen,
    refreshKey,
    workspaceIsWorktree,
  } = context;
  const loadGit = useCallback(async () => {
    const id = ++gitRequest.current;
    setGitError(undefined);
    try {
      const info = await window.artemis.getProjectGitInfo(project.id, threadId);
      if (gitRequest.current === id) setGitInfo(info);
    } catch (error) {
      if (gitRequest.current === id) {
        setGitError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [project.id, threadId]);

  useEffect(() => {
    setChangedFiles([]);
    setChangesError(undefined);
    if (!open || !gitInfo?.managed || !threadId || gitInfo.changeCount === 0)
      return;
    let active = true;
    void Promise.all(
      (["unstaged", "staged"] as const).map(async (scope) => ({
        scope,
        diff: await window.artemis.getReviewDiff({ threadId, scope }),
      })),
    )
      .then((results) => {
        if (!active) return;
        const files = new Map<string, ReviewFile & { scope: ReviewScope }>();
        for (const { scope, diff } of results) {
          for (const file of diff.files) {
            const previous = files.get(file.path);
            files.set(
              file.path,
              previous
                ? {
                    ...previous,
                    additions: previous.additions + file.additions,
                    deletions: previous.deletions + file.deletions,
                  }
                : { ...file, scope },
            );
          }
        }
        setChangedFiles([...files.values()]);
      })
      .catch((error: unknown) => {
        if (active)
          setChangesError(
            error instanceof Error ? error.message : String(error),
          );
      });
    return () => {
      active = false;
    };
  }, [gitInfo, open, threadId]);

  const loadPullRequest = useCallback(async () => {
    const id = ++pullRequestRequest.current;
    setPullRequestLoading(true);
    try {
      const lookup = await window.artemis.getProjectPullRequest(
        project.id,
        threadId,
      );
      if (pullRequestRequest.current !== id) return;
      setPullRequestError(undefined);
      setPullRequestLookup(lookup);
      if (lookup.status !== "found") setChecksOpen(false);
    } catch (error) {
      if (pullRequestRequest.current === id) {
        setPullRequestError(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (pullRequestRequest.current === id) setPullRequestLoading(false);
    }
  }, [project.id, threadId]);

  useEffect(() => {
    setGitInfo(undefined);
  }, [project.id, threadId]);

  useEffect(() => {
    setPullRequestLookup(undefined);
    setPullRequestError(undefined);
    setChecksOpen(false);
    setCommitOpen(false);
    setCommitMessage("");
    setIncludeUnstaged(true);
    setCreatingCommitBranch(false);
    setNewCommitBranch(suggestedEnvironmentBranchName(taskTitle));
    setBranchOpen(false);
    setBranchQuery("");
    setBranchMenuPosition(undefined);
    setCreatingMenuBranch(false);
    setMenuBranchName("");
    setPendingSwitchBranch(undefined);
  }, [project.id, taskTitle, threadId]);

  useEffect(() => {
    if (open) return;
    closeBranchMenu();
    setChecksOpen(false);
  }, [closeBranchMenu, open]);

  const gitActive = defaultOpen || open;
  useEffect(() => {
    if (!gitActive) return;
    void loadGit();
  }, [gitActive, loadGit, refreshKey, workspaceIsWorktree]);

  useEffect(() => {
    if (!open) return;
    void loadPullRequest();
  }, [loadPullRequest, open, refreshKey, workspaceIsWorktree]);
  return { loadGit, loadPullRequest };
}
