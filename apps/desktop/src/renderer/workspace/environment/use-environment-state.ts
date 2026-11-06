import {
  labels,
  suggestedEnvironmentBranchName,
  type EnvironmentBranchMenuLayout,
} from "./environment-values.js";

import { useId, useRef, useState } from "react";

import type {
  ProjectGitInfo,
  ProjectPullRequestLookup,
  ReviewScope,
  ReviewFile,
} from "../../../shared/api.js";

interface UseEnvironmentStateContext {
  readonly locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
  readonly taskTitle: string;
}
export function useEnvironmentState(context: UseEnvironmentStateContext) {
  const { locale, taskTitle } = context;
  const t = labels[locale];
  const panelId = useId();
  const control = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const gitRequest = useRef(0);
  const pullRequestRequest = useRef(0);
  const checksTrigger = useRef<HTMLButtonElement>(null);
  const checksPopover = useRef<HTMLDivElement>(null);
  const branchTrigger = useRef<HTMLButtonElement>(null);
  const branchMenu = useRef<HTMLDivElement>(null);
  const branchSearch = useRef<HTMLInputElement>(null);
  const checksCloseTimer = useRef<number | undefined>(undefined);
  const wantsOpen = useRef<boolean | undefined>(undefined);
  const manuallyOpened = useRef(false);
  const focusOnOpen = useRef(false);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [gitInfo, setGitInfo] = useState<ProjectGitInfo>();
  const [gitError, setGitError] = useState<string>();
  const [changedFiles, setChangedFiles] = useState<
    Array<ReviewFile & { scope: ReviewScope }>
  >([]);
  const [changesError, setChangesError] = useState<string>();
  const [pullRequestLookup, setPullRequestLookup] =
    useState<ProjectPullRequestLookup>();
  const [pullRequestError, setPullRequestError] = useState<string>();
  const [pullRequestLoading, setPullRequestLoading] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [gitBusy, setGitBusy] = useState<
    "commit" | "push" | "commit-push" | "branch"
  >();
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [creatingCommitBranch, setCreatingCommitBranch] = useState(false);
  const [newCommitBranch, setNewCommitBranch] = useState(() =>
    suggestedEnvironmentBranchName(taskTitle),
  );
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchMenuPosition, setBranchMenuPosition] =
    useState<EnvironmentBranchMenuLayout>();
  const [creatingMenuBranch, setCreatingMenuBranch] = useState(false);
  const [menuBranchName, setMenuBranchName] = useState("");
  const [pendingSwitchBranch, setPendingSwitchBranch] = useState<string>();
  const [showAllAgents, setShowAllAgents] = useState(false);
  return {
    t,
    panelId,
    control,
    panel,
    trigger,
    gitRequest,
    pullRequestRequest,
    checksTrigger,
    checksPopover,
    branchTrigger,
    branchMenu,
    branchSearch,
    checksCloseTimer,
    wantsOpen,
    manuallyOpened,
    focusOnOpen,
    openRef,
    open,
    setOpen,
    gitInfo,
    setGitInfo,
    gitError,
    setGitError,
    changedFiles,
    setChangedFiles,
    changesError,
    setChangesError,
    pullRequestLookup,
    setPullRequestLookup,
    pullRequestError,
    setPullRequestError,
    pullRequestLoading,
    setPullRequestLoading,
    checksOpen,
    setChecksOpen,
    gitBusy,
    setGitBusy,
    commitOpen,
    setCommitOpen,
    commitMessage,
    setCommitMessage,
    includeUnstaged,
    setIncludeUnstaged,
    creatingCommitBranch,
    setCreatingCommitBranch,
    newCommitBranch,
    setNewCommitBranch,
    branchOpen,
    setBranchOpen,
    branchQuery,
    setBranchQuery,
    branchMenuPosition,
    setBranchMenuPosition,
    creatingMenuBranch,
    setCreatingMenuBranch,
    menuBranchName,
    setMenuBranchName,
    pendingSwitchBranch,
    setPendingSwitchBranch,
    showAllAgents,
    setShowAllAgents,
  };
}
