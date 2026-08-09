import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import type { AppLocale, Project, RunMode } from "@artemis/protocol";

import type { ProjectGitInfo } from "../shared/api.js";
import { legacyLocale } from "../shared/locales.js";
import { localizedCopy } from "../shared/i18n-resources.js";
import { CodexSelect } from "./CodexSelect.js";

type Locale = AppLocale;

interface ComposerContextBarProps {
  activeProject: Project;
  branchActionsDisabled: boolean;
  locale: Locale;
  mode: RunMode;
  onClearProject(): void;
  onError(message: string): void;
  onModeChange(mode: RunMode): void;
  onOpenProject(): Promise<void>;
  onSelectProject(project: Project): void;
  projects: Project[];
}

const labels = {
  en: {
    projectMenu: "Project menu",
    searchProjects: "Search projects",
    addProject: "Add project",
    clearProject: "Work without a project",
    noProjects: "No matching projects",
    branchMenu: "Branch menu",
    searchBranches: "Search branches",
    branches: "Branches",
    noBranches: "No matching local branches",
    createBranch: "Create and checkout new branch…",
    branchName: "Branch name",
    branchNamePlaceholder: "feature/my-branch",
    branchNameHelp: "The new branch starts at the current HEAD.",
    cancel: "Cancel",
    create: "Create branch",
    retry: "Retry",
    loadingGit: "Loading Git status",
    changingBranch: "Changing branch…",
    taskMode: "Task mode",
    plan: "Plan",
    execute: "Execute",
    review: "Review",
    detached: "Detached HEAD",
    stopTasks: "Stop the active task to change branches.",
    uncommitted(count: number) {
      return `${count} uncommitted ${count === 1 ? "file" : "files"}`;
    },
  },
  "zh-CN": {
    projectMenu: "项目菜单",
    searchProjects: "搜索项目",
    addProject: "新建项目",
    clearProject: "不在项目中工作",
    noProjects: "没有匹配的项目",
    branchMenu: "分支菜单",
    searchBranches: "搜索分支",
    branches: "分支",
    noBranches: "没有匹配的本地分支",
    createBranch: "创建并检出新分支…",
    branchName: "分支名称",
    branchNamePlaceholder: "feature/my-branch",
    branchNameHelp: "新分支将从当前 HEAD 创建。",
    cancel: "取消",
    create: "创建分支",
    retry: "重试",
    loadingGit: "正在读取 Git 状态",
    changingBranch: "正在切换分支…",
    taskMode: "任务模式",
    plan: "规划",
    execute: "执行",
    review: "审查",
    detached: "游离 HEAD",
    stopTasks: "请先停止正在执行的任务，再更改分支。",
    uncommitted(count: number) {
      return `未提交：${count} 个文件`;
    },
  },
} satisfies Record<"en" | "zh-CN", Record<string, unknown>>;

function ContextIcon({
  children,
  size = 18,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

function FolderIcon() {
  return (
    <ContextIcon>
      <path
        d="M3.5 6.5h6l2 2h9v9.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V6.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </ContextIcon>
  );
}

function BranchIcon() {
  return (
    <ContextIcon>
      <circle cx="7" cy="5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="19" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7 7v10m2-4h2.5A5.5 5.5 0 0 0 17 7.5V7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </ContextIcon>
  );
}

function SearchIcon() {
  return (
    <ContextIcon size={16}>
      <circle
        cx="10.7"
        cy="10.7"
        r="6.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="m15.4 15.4 4.1 4.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </ContextIcon>
  );
}

function PlusIcon() {
  return (
    <ContextIcon>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </ContextIcon>
  );
}

function CloseIcon() {
  return (
    <ContextIcon>
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </ContextIcon>
  );
}

function ModeIcon() {
  return (
    <ContextIcon>
      <path
        d="M7 4.5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m8.5 9 2.5 3-2.5 3m5-6h2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </ContextIcon>
  );
}

function CheckIcon() {
  return (
    <ContextIcon size={17}>
      <path
        d="m5 12.5 4.2 4.2L19 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </ContextIcon>
  );
}

interface ContextMenuLayout extends CSSProperties {
  left: number;
  maxHeight: number;
  width: number;
}

export function contextMenuLayout(
  rootWidth: number,
  anchorOffset: number,
  spaceAbove: number,
): ContextMenuLayout {
  const width = Math.floor(Math.min(350, Math.max(0, rootWidth)));
  const leftWithinRoot = Math.min(
    Math.max(0, anchorOffset),
    Math.max(0, rootWidth - width),
  );
  return {
    left: Math.round(leftWithinRoot - anchorOffset),
    maxHeight: Math.max(160, Math.floor(spaceAbove - 16)),
    width,
  };
}

export function ComposerContextBar({
  activeProject,
  branchActionsDisabled,
  locale,
  mode,
  onClearProject,
  onError,
  onModeChange,
  onOpenProject,
  onSelectProject,
  projects,
}: ComposerContextBarProps) {
  const t = localizedCopy(locale, "app", labels[legacyLocale(locale)]);
  const rootRef = useRef<HTMLDivElement>(null);
  const projectControlRef = useRef<HTMLDivElement>(null);
  const branchControlRef = useRef<HTMLDivElement>(null);
  const projectSearchRef = useRef<HTMLInputElement>(null);
  const branchSearchRef = useRef<HTMLInputElement>(null);
  const branchRequest = useRef(0);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [gitInfo, setGitInfo] = useState<ProjectGitInfo>();
  const [gitLoading, setGitLoading] = useState(true);
  const [gitError, setGitError] = useState<string>();
  const [branchBusy, setBranchBusy] = useState<string>();
  const [branchError, setBranchError] = useState<string>();
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [menuLayout, setMenuLayout] = useState<ContextMenuLayout>();

  const loadGitInfo = useCallback(async () => {
    const request = ++branchRequest.current;
    setGitLoading(true);
    setGitError(undefined);
    try {
      const info = await window.artemis.getProjectGitInfo(activeProject.id);
      if (request !== branchRequest.current) return;
      setGitInfo(info);
    } catch (error) {
      if (request !== branchRequest.current) return;
      setGitInfo(undefined);
      setGitError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === branchRequest.current) setGitLoading(false);
    }
  }, [activeProject.id]);

  useEffect(() => {
    setGitInfo(undefined);
    setBranchMenuOpen(false);
    setBranchQuery("");
    setBranchError(undefined);
    setCreatingBranch(false);
    setNewBranchName("");
    void loadGitInfo();
    return () => {
      branchRequest.current += 1;
    };
  }, [loadGitInfo]);

  const updateMenuLayout = useCallback(() => {
    const root = rootRef.current;
    const anchor = projectMenuOpen
      ? projectControlRef.current
      : branchMenuOpen
        ? branchControlRef.current
        : undefined;
    if (!root || !anchor) return;
    const rootRect = root.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const next = contextMenuLayout(
      rootRect.width,
      anchorRect.left - rootRect.left,
      rootRect.top,
    );
    setMenuLayout((current) =>
      current?.left === next.left &&
      current.maxHeight === next.maxHeight &&
      current.width === next.width
        ? current
        : next,
    );
  }, [branchMenuOpen, projectMenuOpen]);

  useLayoutEffect(() => {
    if (!projectMenuOpen && !branchMenuOpen) {
      setMenuLayout(undefined);
      const conversation =
        rootRef.current?.closest<HTMLElement>(".conversation");
      if (conversation) conversation.scrollLeft = 0;
      return;
    }
    updateMenuLayout();
    const root = rootRef.current;
    const observer =
      root && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateMenuLayout)
        : undefined;
    if (root) observer?.observe(root);
    window.addEventListener("resize", updateMenuLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateMenuLayout);
    };
  }, [branchMenuOpen, projectMenuOpen, updateMenuLayout]);

  useEffect(() => {
    if (projectMenuOpen && menuLayout) {
      projectSearchRef.current?.focus({ preventScroll: true });
    }
  }, [menuLayout, projectMenuOpen]);

  useEffect(() => {
    if (branchMenuOpen && !creatingBranch && menuLayout) {
      branchSearchRef.current?.focus({ preventScroll: true });
    }
  }, [branchMenuOpen, creatingBranch, menuLayout]);

  useEffect(() => {
    if (!projectMenuOpen && !branchMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setProjectMenuOpen(false);
      setBranchMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (creatingBranch) {
        setCreatingBranch(false);
        setBranchError(undefined);
        return;
      }
      setProjectMenuOpen(false);
      setBranchMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [branchMenuOpen, creatingBranch, projectMenuOpen]);

  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLocaleLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      project.name.toLocaleLowerCase().includes(query),
    );
  }, [projectQuery, projects]);

  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLocaleLowerCase();
    const branches = gitInfo?.branches ?? [];
    const filtered = query
      ? branches.filter((branch) =>
          branch.name.toLocaleLowerCase().includes(query),
        )
      : branches;
    return [...filtered].sort((left, right) =>
      left.current === right.current
        ? left.name.localeCompare(right.name)
        : left.current
          ? -1
          : 1,
    );
  }, [branchQuery, gitInfo?.branches]);

  const switchBranch = async (branchName: string) => {
    if (branchActionsDisabled || branchBusy) return;
    setBranchBusy(branchName);
    setBranchError(undefined);
    try {
      const info = await window.artemis.switchProjectBranch(
        activeProject.id,
        branchName,
      );
      setGitInfo(info);
      setBranchMenuOpen(false);
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchBusy(undefined);
    }
  };

  const createBranch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (branchActionsDisabled || branchBusy || !newBranchName.trim()) return;
    setBranchBusy(newBranchName.trim());
    setBranchError(undefined);
    try {
      const info = await window.artemis.createProjectBranch(
        activeProject.id,
        newBranchName,
      );
      setGitInfo(info);
      setCreatingBranch(false);
      setNewBranchName("");
      setBranchMenuOpen(false);
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchBusy(undefined);
    }
  };

  const branchLabel = gitInfo?.currentBranch
    ? gitInfo.currentBranch
    : gitInfo?.detached
      ? `${t.detached}${gitInfo.head ? ` · ${gitInfo.head}` : ""}`
      : undefined;

  return (
    <div className="composer-context" ref={rootRef}>
      <div className="composer-context-control" ref={projectControlRef}>
        <button
          aria-expanded={projectMenuOpen}
          aria-haspopup="menu"
          className="composer-context-trigger project-context-trigger"
          onClick={() => {
            setBranchMenuOpen(false);
            setProjectMenuOpen((current) => !current);
          }}
          title={activeProject.path}
          type="button"
        >
          <FolderIcon />
          <strong>{activeProject.name}</strong>
        </button>
        {projectMenuOpen && (
          <div
            aria-label={t.projectMenu}
            className="composer-context-menu project-context-menu"
            role="menu"
            style={menuLayout}
          >
            <label className="composer-context-search">
              <SearchIcon />
              <input
                aria-label={t.searchProjects}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder={t.searchProjects}
                ref={projectSearchRef}
                value={projectQuery}
              />
            </label>
            <div className="composer-context-menu-list">
              {filteredProjects.length === 0 ? (
                <p className="composer-context-empty">{t.noProjects}</p>
              ) : (
                filteredProjects.map((project) => {
                  const selected = project.id === activeProject.id;
                  return (
                    <button
                      aria-checked={selected}
                      className={selected ? "selected" : ""}
                      key={project.id}
                      onClick={() => {
                        setProjectMenuOpen(false);
                        if (!selected) onSelectProject(project);
                      }}
                      role="menuitemradio"
                      title={project.path}
                      type="button"
                    >
                      <FolderIcon />
                      <span>{project.name}</span>
                      <i aria-hidden="true">
                        {selected ? <CheckIcon /> : null}
                      </i>
                    </button>
                  );
                })
              )}
            </div>
            <div className="composer-context-menu-actions">
              <button
                onClick={() => {
                  setProjectMenuOpen(false);
                  void onOpenProject().catch((error) =>
                    onError(
                      error instanceof Error ? error.message : String(error),
                    ),
                  );
                }}
                role="menuitem"
                type="button"
              >
                <PlusIcon />
                <span>{t.addProject}</span>
              </button>
              <button
                onClick={() => {
                  setProjectMenuOpen(false);
                  onClearProject();
                }}
                role="menuitem"
                type="button"
              >
                <CloseIcon />
                <span>{t.clearProject}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {gitLoading && !gitInfo ? (
        <span
          aria-label={t.loadingGit}
          className="composer-context-git-loading"
          role="status"
        >
          <span />
        </span>
      ) : (gitInfo?.managed && branchLabel) || gitError ? (
        <div className="composer-context-control" ref={branchControlRef}>
          <button
            aria-expanded={branchMenuOpen}
            aria-haspopup="menu"
            className="composer-context-trigger branch-context-trigger"
            onClick={() => {
              const opening = !branchMenuOpen;
              setProjectMenuOpen(false);
              setBranchMenuOpen(opening);
              if (opening) void loadGitInfo();
            }}
            title={gitInfo?.root}
            type="button"
          >
            <BranchIcon />
            <span>{branchLabel ?? "Git"}</span>
          </button>
          {branchMenuOpen && (
            <div
              aria-label={t.branchMenu}
              className="composer-context-menu branch-context-menu"
              role="menu"
              style={menuLayout}
            >
              {creatingBranch ? (
                <form className="branch-create-form" onSubmit={createBranch}>
                  <label htmlFor="new-project-branch">{t.branchName}</label>
                  <input
                    autoFocus
                    disabled={Boolean(branchBusy)}
                    id="new-project-branch"
                    onChange={(event) => setNewBranchName(event.target.value)}
                    placeholder={t.branchNamePlaceholder}
                    value={newBranchName}
                  />
                  <small>{t.branchNameHelp}</small>
                  {branchError && (
                    <p className="composer-context-error" role="alert">
                      {branchError}
                    </p>
                  )}
                  <div>
                    <button
                      className="secondary-button"
                      disabled={Boolean(branchBusy)}
                      onClick={() => {
                        setCreatingBranch(false);
                        setBranchError(undefined);
                      }}
                      type="button"
                    >
                      {t.cancel}
                    </button>
                    <button
                      className="primary-button"
                      disabled={Boolean(branchBusy) || !newBranchName.trim()}
                      type="submit"
                    >
                      {branchBusy ? t.changingBranch : t.create}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <label className="composer-context-search">
                    <SearchIcon />
                    <input
                      aria-label={t.searchBranches}
                      onChange={(event) => setBranchQuery(event.target.value)}
                      placeholder={t.searchBranches}
                      ref={branchSearchRef}
                      value={branchQuery}
                    />
                  </label>
                  <div className="composer-context-menu-heading">
                    {t.branches}
                  </div>
                  {gitLoading && !gitInfo ? (
                    <div
                      aria-label={t.loadingGit}
                      className="composer-context-menu-skeleton"
                      role="status"
                    >
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : gitError ? (
                    <div className="composer-context-menu-error" role="alert">
                      <p>{gitError}</p>
                      <button onClick={() => void loadGitInfo()} type="button">
                        {t.retry}
                      </button>
                    </div>
                  ) : (
                    <div className="composer-context-menu-list branch-list">
                      {filteredBranches.length === 0 ? (
                        <p className="composer-context-empty">{t.noBranches}</p>
                      ) : (
                        filteredBranches.map((branch) => (
                          <button
                            aria-checked={branch.current}
                            className={branch.current ? "selected" : ""}
                            disabled={
                              Boolean(branchBusy) ||
                              (branchActionsDisabled && !branch.current)
                            }
                            key={branch.name}
                            onClick={() => {
                              if (branch.current) setBranchMenuOpen(false);
                              else void switchBranch(branch.name);
                            }}
                            role="menuitemradio"
                            type="button"
                          >
                            <BranchIcon />
                            <span>
                              <strong>{branch.name}</strong>
                              {branch.current && (
                                <small>
                                  {t.uncommitted(gitInfo?.changeCount ?? 0)}
                                </small>
                              )}
                            </span>
                            <i aria-hidden="true">
                              {branch.current ? <CheckIcon /> : null}
                            </i>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  {branchError && (
                    <p className="composer-context-error" role="alert">
                      {branchError}
                    </p>
                  )}
                  {branchActionsDisabled && (
                    <p className="composer-context-hint">{t.stopTasks}</p>
                  )}
                  <div className="composer-context-menu-actions branch-menu-actions">
                    <button
                      disabled={branchActionsDisabled || Boolean(branchBusy)}
                      onClick={() => {
                        setCreatingBranch(true);
                        setBranchError(undefined);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <PlusIcon />
                      <span>{t.createBranch}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      <div className="composer-context-picker" title={t.taskMode}>
        <ModeIcon />
        <CodexSelect<RunMode>
          ariaLabel={t.taskMode}
          disabled={branchActionsDisabled}
          onChange={onModeChange}
          options={[
            { value: "plan", label: t.plan },
            { value: "execute", label: t.execute },
            { value: "review", label: t.review },
          ]}
          value={mode}
        />
      </div>
    </div>
  );
}
