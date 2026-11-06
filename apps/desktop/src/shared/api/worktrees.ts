import type { TaskWorktree, Thread } from "@artemis/protocol";

export interface WorktreeCleanupCandidate {
  worktree: TaskWorktree;
  title: string;
  projectName: string;
  busy: boolean;
  expired: boolean;
  clean: boolean;
  pushedToGitHub: boolean;
  recommended: boolean;
  error?: string;
}

export interface CleanupWorktreeResult {
  thread: Thread;
  worktree: TaskWorktree;
}

export interface RestoreWorktreeSnapshotResult {
  worktree: TaskWorktree;
  restoredFiles: string[];
}

export interface HandoffWorkspaceResult {
  thread: Thread;
  worktree?: TaskWorktree;
  bundlePath: string;
}
