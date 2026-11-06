import { UI_COPY } from "../../../shared/i18n/ui-copy.js";
import { type CSSProperties } from "react";
import { type AppLocale } from "@artemis/protocol";
import type {
  ProjectGitBranch,
  ProjectGitInfo,
  ProjectPullRequest,
  ProjectPullRequestCheck,
} from "../../../shared/api.js";

export const labels = UI_COPY.EnvironmentPanel_labels satisfies Record<
  AppLocale,
  Record<string, unknown>
>;

export function suggestedEnvironmentBranchName(title: string): string {
  const slug = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60)
    .replace(/-+$/gu, "");
  return `codex/${slug || "changes"}`;
}

export interface EnvironmentBranchMenuLayout extends CSSProperties {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

export function environmentBranchMenuLayout(
  anchor: Readonly<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }>,
  viewport: Readonly<{ width: number; height: number }>,
): EnvironmentBranchMenuLayout {
  const margin = 12;
  const width = Math.min(296, Math.max(0, viewport.width - margin * 2));
  const left = Math.min(
    Math.max(margin, anchor.left - width),
    Math.max(margin, viewport.width - width - margin),
  );
  const top = Math.min(
    Math.max(margin, anchor.top),
    Math.max(margin, viewport.height - margin - 160),
  );
  return {
    left,
    maxHeight: Math.max(160, viewport.height - top - margin),
    top,
    width,
  };
}

export function projectPullRequestCheckSummary(
  checks: readonly ProjectPullRequestCheck[],
): ProjectPullRequestCheckSummary {
  if (checks.length === 0) return "none";
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (checks.some((check) => check.status === "cancelled")) return "cancelled";
  if (checks.every((check) => check.status === "skipped")) return "skipped";
  return "passed";
}

export type ProjectPullRequestCheckSummary =
  "passed" | "failed" | "pending" | "skipped" | "cancelled" | "none";

export function projectPullRequestCoverageWarning(
  gitInfo: ProjectGitInfo,
  pullRequest: ProjectPullRequest,
): ProjectPullRequestCoverageWarning | undefined {
  if (gitInfo.changeCount > 0) return "working-tree";
  if (
    gitInfo.ahead > 0 &&
    (!gitInfo.headOid || gitInfo.headOid !== pullRequest.headRefOid)
  ) {
    return "unpushed";
  }
  if (gitInfo.headOid && gitInfo.headOid !== pullRequest.headRefOid) {
    return "head-mismatch";
  }
  return undefined;
}

export function environmentGitAction(
  info: ProjectGitInfo,
  actionsDisabled: boolean,
  copy: {
    stopTasks: string;
    conflicts: string;
    behind: string;
    noUpstream: string;
    synced: string;
    detachedBlocked: string;
  },
): GitEnvironmentAction {
  if (info.changeCount > 0) {
    return {
      kind: "commit",
      ...(actionsDisabled
        ? { disabledReason: copy.stopTasks }
        : !info.currentBranch
          ? { disabledReason: copy.detachedBlocked }
          : info.conflictCount > 0
            ? { disabledReason: copy.conflicts }
            : {}),
    };
  }
  if (info.ahead > 0) {
    return {
      kind: "push",
      ...(actionsDisabled
        ? { disabledReason: copy.stopTasks }
        : info.behind > 0
          ? { disabledReason: copy.behind }
          : {}),
    };
  }
  return {
    kind: "idle",
    disabledReason: !info.currentBranch
      ? copy.detachedBlocked
      : !info.upstream
        ? copy.noUpstream
        : info.behind > 0
          ? copy.behind
          : copy.synced,
  };
}

export function environmentBranchMenuBranches(
  branches: readonly ProjectGitBranch[],
  query: string,
): ProjectGitBranch[] {
  const deduplicated = new Map<string, ProjectGitBranch>();
  for (const branch of branches) {
    const displayName = environmentBranchDisplayName(branch);
    const existing = deduplicated.get(displayName);
    if (!existing || (existing.remote && !branch.remote)) {
      deduplicated.set(displayName, branch);
    }
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return [...deduplicated.values()]
    .filter(
      (branch) =>
        !normalizedQuery ||
        environmentBranchDisplayName(branch)
          .toLocaleLowerCase()
          .includes(normalizedQuery),
    )
    .sort(
      (left, right) =>
        Number(Boolean(left.remote)) - Number(Boolean(right.remote)) ||
        Number(right.current) - Number(left.current),
    );
}

export type ProjectPullRequestCoverageWarning =
  "working-tree" | "unpushed" | "head-mismatch";

export type GitEnvironmentAction =
  | { kind: "commit"; disabledReason?: string }
  | { kind: "push"; disabledReason?: string }
  | { kind: "idle"; disabledReason: string };

export function environmentBranchDisplayName(branch: ProjectGitBranch): string {
  return branch.remote ? branch.name.replace(/^[^/]+\//u, "") : branch.name;
}
