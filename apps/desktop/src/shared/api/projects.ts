import type { Project } from "@artemis/protocol";

export interface ProjectsApi {
  openProject(): Promise<Project | undefined>;
  removeProject(projectId: string): Promise<void>;
  readProjectInstructions(projectId: string): Promise<string>;
  writeProjectInstructions(projectId: string, content: string): Promise<void>;
  onThreadLinkOpen(listener: (threadId: string | null) => void): () => void;
  getProjectGitInfo(
    projectId: string,
    threadId?: string,
  ): Promise<ProjectGitInfo>;
  getProjectPullRequest(
    projectId: string,
    threadId?: string,
  ): Promise<ProjectPullRequestLookup>;
  switchProjectBranch(
    projectId: string,
    branchName: string,
    threadId?: string,
  ): Promise<ProjectGitInfo>;
  createProjectBranch(
    projectId: string,
    branchName: string,
    threadId?: string,
  ): Promise<ProjectGitInfo>;
  commitProjectChanges(
    projectId: string,
    message: string,
    includeUnstaged: boolean,
    threadId?: string,
  ): Promise<ProjectGitCommitResult>;
  pushProjectBranch(
    projectId: string,
    threadId?: string,
  ): Promise<ProjectGitPushResult>;
}

export interface ProjectGitBranch {
  name: string;
  current: boolean;
  upstream?: string;
  remote?: boolean;
}

export interface ProjectGitInfo {
  managed: boolean;
  root?: string;
  currentBranch?: string;
  head?: string;
  headOid?: string;
  detached: boolean;
  changeCount: number;
  additions: number;
  deletions: number;
  stagedAdditions: number;
  stagedDeletions: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
  upstream?: string;
  compareBase?: string;
  ahead: number;
  behind: number;
  branches: ProjectGitBranch[];
}

export type ProjectPullRequestState = "OPEN" | "CLOSED" | "MERGED";

export type ProjectPullRequestCheckStatus =
  "passed" | "failed" | "pending" | "skipped" | "cancelled";

export interface ProjectPullRequestCheck {
  name: string;
  status: ProjectPullRequestCheckStatus;
  detailsUrl?: string;
  workflowName?: string;
}

export interface ProjectPullRequest {
  number: number;
  title: string;
  url: string;
  state: ProjectPullRequestState;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  checks: ProjectPullRequestCheck[];
}

export type ProjectPullRequestLookup =
  | { status: "found"; pullRequest: ProjectPullRequest }
  | { status: "not-found" }
  | {
      status: "unavailable";
      reason: "gh-not-installed" | "authentication-required";
    };

export interface ProjectGitCommitResult {
  commit: string;
  gitInfo: ProjectGitInfo;
}

export interface ProjectGitPushResult {
  upstream: string;
  gitInfo: ProjectGitInfo;
}
