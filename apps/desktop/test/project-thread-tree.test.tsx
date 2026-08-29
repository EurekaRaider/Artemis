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
  onActivate,
  onCollapse,
  onExpand,
  onButtonActivate,
}: {
  projects: HarnessProject[];
  temporaryThreads: HarnessThread[];
  activeThreadId?: string;
  onActivate?: (rowId: string) => void;
  onCollapse?: (rowId: string) => void;
  onExpand?: (rowId: string) => void;
  onButtonActivate?: (name: string) => void;
}) {
  const treeElement = useRef<HTMLDivElement>(null);
  const [activeRowId, setActiveRowId] = useState<string>();
  const [projectsOpen, setProjectsOpen] = useState(true);
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
          collapseRow: (rowId) => onCollapse?.(rowId),
          expandRow: (rowId) => onExpand?.(rowId),
          activateRow: (rowId) => onActivate?.(rowId),
        })
      }
      ref={treeElement}
      role="tree"
    >
      <section
        aria-expanded={projectsOpen}
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
            className="project-group-select"
            onClick={() => setProjectsOpen((open) => !open)}
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
        <div className="project-collection-rows" role="group">
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
                        <button
                          className="thread-select"
                          onClick={() =>
                            onButtonActivate?.(`open-${thread.id}`)
                          }
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

  it("keeps auxiliary controls reachable by Tab from the active row", async () => {
    const user = userEvent.setup();
    render(
      <SidebarTreeHarness projects={PROJECTS} temporaryThreads={TEMPORARY} />,
    );
    row("collection:projects").focus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Projects", exact: false }),
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
