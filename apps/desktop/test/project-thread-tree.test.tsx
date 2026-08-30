// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import {
  clampTreeActiveRowId,
  handleProjectTreeKeyDown,
  readVisibleTreeRows,
  treeRowIdForKey,
} from "../src/renderer/project-thread-tree.js";

interface HarnessThread {
  id: string;
  title: string;
}

interface HarnessProject {
  id: string;
  name: string;
  threads: HarnessThread[];
  showMore?: boolean;
  open?: boolean;
}

/**
 * Production-equivalent markup for the sidebar tree (mirrors App.tsx):
 * one `role="tree"` whose rows are `role="treeitem"` containers
 * (collection L1 / project L2 / thread L3 / temporary L1), thread groups
 * are `role="group"`, and every auxiliary control (group toggle, new,
 * more-actions, thread-select, thread-action, show-more) is present with
 * its native Tab reachability exactly like the real sidebar.
 */
function SidebarTreeHarness({
  projects,
  temporaryThreads,
  activeThreadId,
  initialProjectsOpen = true,
  query = "",
  renamingThreadId,
  onActivate,
  onCollapse,
  onExpand,
  onButtonActivate,
  onRenameCommit,
}: {
  projects: HarnessProject[];
  temporaryThreads: HarnessThread[];
  activeThreadId?: string;
  initialProjectsOpen?: boolean;
  query?: string;
  renamingThreadId?: string;
  onActivate?: (rowId: string) => void;
  onCollapse?: (rowId: string) => void;
  onExpand?: (rowId: string) => void;
  onButtonActivate?: (name: string) => void;
  onRenameCommit?: () => void;
}) {
  const treeElement = useRef<HTMLDivElement>(null);
  const [activeRowId, setActiveRowId] = useState<string>();
  const [projectsOpen, setProjectsOpen] = useState(initialProjectsOpen);
  // Mirrors App.tsx: one mutable expansion state drives the root treeitem,
  // the internal toggle, the child-group visibility and the keyboard
  // branches; entering a search auto-expands, user collapse is honoured.
  const [projectsExpanded, setProjectsExpanded] = useState(initialProjectsOpen);
  const projectsSearchQueryRef = useRef("");
  useEffect(() => {
    const wasSearching = projectsSearchQueryRef.current.trim().length > 0;
    const isSearching = query.trim().length > 0;
    projectsSearchQueryRef.current = query;
    if (isSearching && !wasSearching) {
      setProjectsExpanded(true);
    } else if (!isSearching && wasSearching) {
      setProjectsExpanded(projectsOpen);
    }
  }, [projectsOpen, query]);
  const toggleProjectsExpansion = useCallback(() => {
    // Compute ONE next value from the authoritative visible state and sync
    // both states to it — two independent functional toggles can diverge
    // after the search auto-expansion (expanded=true, open=false) and the
    // leave-search restore would then undo the user's collapse.
    const next = !projectsExpanded;
    setProjectsExpanded(next);
    setProjectsOpen(next);
  }, [projectsExpanded]);
  const [temporaryOpen, setTemporaryOpen] = useState(true);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setActiveRowId((current) =>
      clampTreeActiveRowId(treeElement.current, current),
    );
  });

  const focusRow = useCallback((rowId: string) => {
    setActiveRowId(rowId);
    treeElement.current
      ?.querySelector<HTMLElement>(`[data-tree-row-id="${CSS.escape(rowId)}"]`)
      ?.focus();
  }, []);

  const tabIndexFor = (rowId: string, isInitial = false) =>
    activeRowId === rowId || (activeRowId === undefined && isInitial) ? 0 : -1;

  return (
    <div
      aria-label="Projects"
      className="project-tree"
      onKeyDown={(event) =>
        handleProjectTreeKeyDown(event.nativeEvent, {
          container: treeElement.current,
          focusRow,
          collapseRow: (rowId) => {
            onCollapse?.(rowId);
            if (rowId === "collection:projects") {
              setProjectsExpanded(false);
              setProjectsOpen(false);
            }
          },
          expandRow: (rowId) => {
            onExpand?.(rowId);
            if (rowId === "collection:projects") {
              setProjectsExpanded(true);
              setProjectsOpen(true);
            }
          },
          activateRow: (rowId) => {
            onActivate?.(rowId);
            if (rowId === "collection:projects") toggleProjectsExpansion();
          },
        })
      }
      ref={treeElement}
      role="tree"
    >
      <section
        aria-expanded={projectsExpanded}
        aria-level={1}
        className="project-group project-collection"
        data-tree-kind="collection"
        data-tree-level={1}
        data-tree-row-id="collection:projects"
        onFocus={() => setActiveRowId("collection:projects")}
        role="treeitem"
        tabIndex={tabIndexFor("collection:projects", true)}
      >
        <div className="project-row project-group-row">
          <button
            aria-expanded={projectsExpanded}
            aria-label={
              projectsExpanded ? "Collapse projects" : "Expand projects"
            }
            className="project-group-select"
            onClick={() => toggleProjectsExpansion()}
            title={projectsExpanded ? "Collapse projects" : "Expand projects"}
            type="button"
          >
            <span className="project-group-title">Projects</span>
          </button>
          <button
            aria-label="Open project"
            className="project-new-thread"
            onClick={() => onButtonActivate?.("open-project")}
            type="button"
          >
            +
          </button>
        </div>
        <div
          className="project-collection-rows"
          hidden={!projectsExpanded}
          role="group"
        >
          {projects.map((project) => {
            const projectOpen =
              project.open ?? !collapsedProjects.has(project.id);
            return (
              <section
                aria-expanded={projectOpen}
                aria-level={2}
                className="project-group nested-project"
                data-tree-kind="project"
                data-tree-level={2}
                data-tree-row-id={`project:${project.id}`}
                key={project.id}
                onFocus={() => setActiveRowId(`project:${project.id}`)}
                role="treeitem"
                tabIndex={tabIndexFor(`project:${project.id}`)}
              >
                <div className="project-row">
                  <button
                    aria-label={
                      projectOpen ? "Collapse history" : "Expand history"
                    }
                    className="project-toggle"
                    onClick={() =>
                      setCollapsedProjects((current) => {
                        const next = new Set(current);
                        if (next.has(project.id)) next.delete(project.id);
                        else next.add(project.id);
                        return next;
                      })
                    }
                    type="button"
                  >
                    ▸
                  </button>
                  <button
                    className="project-select"
                    onClick={() => onButtonActivate?.(`select-${project.id}`)}
                    type="button"
                  >
                    <span className="project-title">{project.name}</span>
                  </button>
                  <button
                    aria-label={`New task: ${project.name}`}
                    className="project-new-thread"
                    onClick={() => onButtonActivate?.("new-thread")}
                    type="button"
                  >
                    +
                  </button>
                  <button
                    aria-label="More project actions"
                    className="project-action"
                    onClick={() => onButtonActivate?.("project-action")}
                    type="button"
                  >
                    ···
                  </button>
                </div>
                {projectOpen && (
                  <div className="project-thread-list" role="group">
                    {project.threads.map((thread) => (
                      <div
                        aria-selected={thread.id === activeThreadId}
                        aria-level={3}
                        className="project-thread-row"
                        data-tree-kind="thread"
                        data-tree-level={3}
                        data-tree-row-id={`thread:${thread.id}`}
                        key={thread.id}
                        onFocus={() => setActiveRowId(`thread:${thread.id}`)}
                        role="treeitem"
                        tabIndex={tabIndexFor(`thread:${thread.id}`)}
                      >
                        {thread.id === renamingThreadId ? (
                          <form
                            className="thread-rename-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              onRenameCommit?.();
                            }}
                          >
                            <input
                              aria-label="Task name"
                              autoFocus
                              className="thread-rename-input"
                              onBlur={() => onRenameCommit?.()}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  onRenameCommit?.();
                                }
                              }}
                            />
                          </form>
                        ) : (
                          <button
                            className="thread-select"
                            onClick={() =>
                              onButtonActivate?.(`open-${thread.id}`)
                            }
                            type="button"
                          >
                            <span className="thread-title">{thread.title}</span>
                          </button>
                        )}
                        <button
                          aria-label="More actions"
                          className="thread-action"
                          onClick={() => onButtonActivate?.("thread-action")}
                          type="button"
                        >
                          ···
                        </button>
                      </div>
                    ))}
                    {project.showMore && (
                      <button
                        aria-level={3}
                        className="project-expand-toggle"
                        data-tree-kind="show-more"
                        data-tree-level={3}
                        data-tree-row-id={`show-more:${project.id}`}
                        onFocus={() =>
                          setActiveRowId(`show-more:${project.id}`)
                        }
                        role="treeitem"
                        tabIndex={tabIndexFor(`show-more:${project.id}`)}
                        onClick={() => onButtonActivate?.("show-more")}
                        type="button"
                      >
                        Show more tasks
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </section>
      <section
        aria-expanded={temporaryOpen}
        aria-level={1}
        className="project-group temporary-conversations"
        data-tree-kind="temporary"
        data-tree-level={1}
        data-tree-row-id="temporary:conversations"
        onFocus={() => setActiveRowId("temporary:conversations")}
        role="treeitem"
        tabIndex={tabIndexFor("temporary:conversations")}
      >
        <div className="project-row project-group-row">
          <button
            className="project-group-select"
            onClick={() => setTemporaryOpen((open) => !open)}
            type="button"
          >
            <span className="project-group-title">Temporary chats</span>
          </button>
          <button
            aria-label="New task: Temporary chats"
            className="project-new-thread"
            onClick={() => onButtonActivate?.("new-temporary")}
            type="button"
          >
            +
          </button>
        </div>
        <div
          className="project-thread-list"
          hidden={!temporaryOpen}
          role="group"
        >
          {temporaryThreads.map((thread) => (
            <div
              aria-selected={thread.id === activeThreadId}
              aria-level={2}
              className="project-thread-row"
              data-tree-kind="thread"
              data-tree-level={2}
              data-tree-row-id={`thread:${thread.id}`}
              key={thread.id}
              onFocus={() => setActiveRowId(`thread:${thread.id}`)}
              role="treeitem"
              tabIndex={tabIndexFor(`thread:${thread.id}`)}
            >
              <button
                className="thread-select"
                onClick={() => onButtonActivate?.(`open-${thread.id}`)}
                type="button"
              >
                <span className="thread-title">{thread.title}</span>
              </button>
              <button
                aria-label="More actions"
                className="thread-action"
                onClick={() => onButtonActivate?.("thread-action")}
                type="button"
              >
                ···
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const PROJECTS: HarnessProject[] = [
  {
    id: "alpha",
    name: "Alpha",
    threads: [
      { id: "a1", title: "Thread A1" },
      { id: "a2", title: "Thread A2" },
    ],
    showMore: true,
  },
  {
    id: "beta",
    name: "Beta",
    threads: [{ id: "b1", title: "Thread B1" }],
    open: false,
  },
];

const TEMPORARY: HarnessThread[] = [{ id: "t1", title: "Temporary chat" }];

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-tree-row-id="${id}"]`,
  );
  expect(element, `row ${id}`).not.toBeNull();
  return element!;
}

function rowIds(): string[] {
  return readVisibleTreeRows(
    document.querySelector<HTMLElement>(".project-tree"),
  ).map((visible) => visible.id);
}

describe("project/thread tree keyboard (rendered, production markup)", () => {
  it("renders a legal tree: one tree, treeitem rows with levels, one Tab stop", () => {
    render(
      <SidebarTreeHarness
        activeThreadId="a1"
        projects={PROJECTS}
        temporaryThreads={TEMPORARY}
      />,
    );
    expect(screen.getByRole("tree")).toHaveAttribute("aria-label", "Projects");
    expect(row("collection:projects")).toHaveAttribute("aria-level", "1");
    expect(row("collection:projects")).toHaveAttribute("aria-expanded", "true");
    expect(row("project:alpha")).toHaveAttribute("aria-level", "2");
    expect(row("thread:a1")).toHaveAttribute("aria-level", "3");
    expect(row("thread:a1")).toHaveAttribute("aria-selected", "true");
    expect(row("thread:a2")).toHaveAttribute("aria-selected", "false");
    expect(row("temporary:conversations")).toHaveAttribute("aria-level", "1");
    expect(row("thread:t1")).toHaveAttribute("aria-level", "2");
    const tabStops = rowIds().filter((id) => row(id).tabIndex === 0);
    expect(tabStops).toEqual(["collection:projects"]);
  });

  it("moves vertically without wrapping and consumes edge keys", async () => {
    const user = userEvent.setup();
    const consumed: string[] = [];
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) consumed.push(event.key);
    };
    document.addEventListener("keydown", listener);
    try {
      render(
        <SidebarTreeHarness projects={PROJECTS} temporaryThreads={TEMPORARY} />,
      );
      expect(rowIds()).toEqual([
        "collection:projects",
        "project:alpha",
        "thread:a1",
        "thread:a2",
        "show-more:alpha",
        "project:beta",
        "temporary:conversations",
        "thread:t1",
      ]);
      row("collection:projects").focus();
      await user.keyboard("{ArrowUp}");
      expect(row("collection:projects")).toHaveFocus();
      expect(consumed).toContain("ArrowUp");

      await user.keyboard("{ArrowDown}");
      expect(row("project:alpha")).toHaveFocus();
      await user.keyboard("{End}");
      expect(row("thread:t1")).toHaveFocus();
      consumed.length = 0;
      await user.keyboard("{ArrowDown}");
      expect(row("thread:t1")).toHaveFocus();
      expect(consumed).toEqual(["ArrowDown"]);
      await user.keyboard("{Home}");
      expect(row("collection:projects")).toHaveFocus();
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  it("expands, collapses and moves between levels horizontally", async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    const onExpand = vi.fn();
    render(
      <SidebarTreeHarness
        onCollapse={onCollapse}
        onExpand={onExpand}
        projects={PROJECTS}
        temporaryThreads={TEMPORARY}
      />,
    );

    row("project:beta").focus();
    await user.keyboard("{ArrowRight}");
    expect(onExpand).toHaveBeenCalledWith("project:beta");

    row("project:alpha").focus();
    await user.keyboard("{ArrowRight}");
    expect(row("thread:a1")).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(row("project:alpha")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(onCollapse).toHaveBeenCalledWith("project:alpha");

    row("thread:a1").focus();
    await user.keyboard("{ArrowRight}");
    expect(row("thread:a1")).toHaveFocus();

    row("collection:projects").focus();
    await user.keyboard("{ArrowLeft}");
    expect(onCollapse).toHaveBeenCalledWith("collection:projects");
    // The collapse really closed the group; expand it back for the block
    // below (real state change).
    await user.keyboard("{ArrowRight}");
    expect(onExpand).toHaveBeenCalledWith("collection:projects");

    // Collapsed branch: ArrowLeft focuses the parent row (WAI-ARIA).
    row("project:beta").focus();
    await user.keyboard("{ArrowLeft}");
    expect(row("collection:projects")).toHaveFocus();
  });

  it("activates rows with Enter/Space and keeps native activation on embedded buttons", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onButtonActivate = vi.fn();
    render(
      <SidebarTreeHarness
        onActivate={onActivate}
        onButtonActivate={onButtonActivate}
        projects={PROJECTS}
        temporaryThreads={TEMPORARY}
      />,
    );

    row("thread:a1").focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith("thread:a1");

    row("thread:a2").focus();
    await user.keyboard("{Space}");
    expect(onActivate).toHaveBeenCalledWith("thread:a2");

    row("project:alpha").focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith("project:alpha");

    row("temporary:conversations").focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith("temporary:conversations");

    onActivate.mockClear();
    screen.getByRole("button", { name: "Beta" }).focus();
    await user.keyboard("{Enter}");
    expect(onButtonActivate).toHaveBeenCalledWith("select-beta");
    expect(onActivate).not.toHaveBeenCalled();

    onButtonActivate.mockClear();
    row("show-more:alpha").focus();
    await user.keyboard("{Enter}");
    expect(onButtonActivate).toHaveBeenCalledWith("show-more");
  });

  it("keeps rename-input editing keys native: no tree hijack, no blur save", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onCollapse = vi.fn();
    const onExpand = vi.fn();
    const onRenameCommit = vi.fn();
    render(
      <SidebarTreeHarness
        onActivate={onActivate}
        onCollapse={onCollapse}
        onExpand={onExpand}
        onRenameCommit={onRenameCommit}
        projects={PROJECTS}
        renamingThreadId="a1"
        temporaryThreads={TEMPORARY}
      />,
    );
    const input = screen.getByLabelText("Task name");
    input.focus();
    await user.keyboard("{ArrowLeft}{ArrowRight}{Home}{End}");
    await user.keyboard("{ArrowUp}{ArrowDown}");
    expect(input).toHaveFocus();
    expect(onActivate).not.toHaveBeenCalled();
    expect(onCollapse).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it("does not hijack arrow keys from embedded buttons", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <SidebarTreeHarness
        onActivate={onActivate}
        projects={PROJECTS}
        temporaryThreads={TEMPORARY}
      />,
    );
    const action = screen.getAllByRole("button", {
      name: "More actions",
    })[0]!;
    action.focus();
    await user.keyboard("{ArrowDown}");
    expect(action).toHaveFocus();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("auto-expands on search and honours user collapse end-to-end", async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    const onExpand = vi.fn();
    render(
      <SidebarTreeHarness
        initialProjectsOpen={false}
        onCollapse={onCollapse}
        onExpand={onExpand}
        projects={PROJECTS}
        query="thread"
        temporaryThreads={TEMPORARY}
      />,
    );
    // Entering the search auto-expanded the collapsed root (real state).
    expect(row("collection:projects")).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Collapse projects" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(rowIds()).toContain("project:alpha");

    // ArrowRight enters the first visible child (no redundant expand call).
    row("collection:projects").focus();
    await user.keyboard("{ArrowRight}");
    expect(row("project:alpha")).toHaveFocus();
    expect(onExpand).not.toHaveBeenCalled();

    // ArrowLeft on the open root really closes the group and syncs the
    // root treeitem AND the internal toggle button.
    row("collection:projects").focus();
    await user.keyboard("{ArrowLeft}");
    expect(onCollapse).toHaveBeenCalledWith("collection:projects");
    expect(row("collection:projects")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Expand projects" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(rowIds()).not.toContain("project:alpha");

    // ArrowRight expands it back (real state change).
    await user.keyboard("{ArrowRight}");
    expect(onExpand).toHaveBeenCalledWith("collection:projects");
    expect(rowIds()).toContain("project:alpha");
  });

  it("keeps a search-time collapse collapsed after the query clears", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const { rerender } = render(
      <SidebarTreeHarness
        initialProjectsOpen={false}
        onActivate={onActivate}
        projects={PROJECTS}
        query="thread"
        temporaryThreads={TEMPORARY}
      />,
    );
    // Internal button click collapses the real state everywhere.
    await user.click(screen.getByRole("button", { name: "Collapse projects" }));
    expect(row("collection:projects")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Expand projects" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(rowIds()).not.toContain("project:alpha");

    // Clearing the query keeps the user's collapse (no re-expand).
    rerender(
      <SidebarTreeHarness
        initialProjectsOpen={false}
        onActivate={onActivate}
        projects={PROJECTS}
        temporaryThreads={TEMPORARY}
      />,
    );
    expect(row("collection:projects")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(rowIds()).not.toContain("project:alpha");

    // Re-entering the search auto-expands again; the root treeitem's Enter
    // follows the same single next value and stays collapsed afterwards.
    rerender(
      <SidebarTreeHarness
        initialProjectsOpen={false}
        onActivate={onActivate}
        projects={PROJECTS}
        query="thread"
        temporaryThreads={TEMPORARY}
      />,
    );
    expect(row("collection:projects")).toHaveAttribute("aria-expanded", "true");
    row("collection:projects").focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith("collection:projects");
    expect(row("collection:projects")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(rowIds()).not.toContain("project:alpha");
    rerender(
      <SidebarTreeHarness
        initialProjectsOpen={false}
        onActivate={onActivate}
        projects={PROJECTS}
        temporaryThreads={TEMPORARY}
      />,
    );
    expect(row("collection:projects")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(rowIds()).not.toContain("project:alpha");
  });

  it("keeps auxiliary controls reachable by Tab from the active row", async () => {
    const user = userEvent.setup();
    render(
      <SidebarTreeHarness projects={PROJECTS} temporaryThreads={TEMPORARY} />,
    );
    row("collection:projects").focus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Collapse projects" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Open project" })).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(row("collection:projects")).toHaveFocus();
  });
});

describe("tree row helpers (pure)", () => {
  const rows = readVisibleTreeRows(document.body);
  expect(rows).toEqual([]);

  it("stops at the edges and jumps with Home/End", () => {
    const visible: Parameters<typeof treeRowIdForKey>[0] = [
      "collection:projects",
      "project:alpha",
      "thread:a1",
    ].map((id, index) => ({
      id,
      level: index === 0 ? 1 : index === 1 ? 2 : 3,
      kind: (index === 2
        ? "thread"
        : index === 1
          ? "project"
          : "collection") as "thread" | "project" | "collection",
    }));
    expect(treeRowIdForKey(visible, "collection:projects", "ArrowUp")).toBe(
      undefined,
    );
    expect(treeRowIdForKey(visible, "thread:a1", "ArrowDown")).toBe(undefined);
    expect(treeRowIdForKey(visible, "project:alpha", "ArrowUp")).toBe(
      "collection:projects",
    );
    expect(treeRowIdForKey(visible, "project:alpha", "ArrowDown")).toBe(
      "thread:a1",
    );
    expect(treeRowIdForKey(visible, "thread:a1", "Home")).toBe(
      "collection:projects",
    );
    expect(treeRowIdForKey(visible, "collection:projects", "End")).toBe(
      "thread:a1",
    );
  });
});
