// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import {
  handleProjectTreeKeyDown,
  readVisibleTreeRows,
  treeRowIdForKey,
} from "../src/renderer/project-thread-tree.js";

describe("treeRowIdForKey", () => {
  const rows = [
    { id: "project:a", level: 2 as const, kind: "project" as const },
    { id: "thread:a1", level: 3 as const, kind: "thread" as const },
    { id: "project:b", level: 2 as const, kind: "project" as const },
    { id: "thread:b1", level: 3 as const, kind: "thread" as const },
  ];

  it("wraps vertically and jumps with Home/End", () => {
    expect(treeRowIdForKey(rows, "thread:a1", "ArrowDown")).toBe("project:b");
    expect(treeRowIdForKey(rows, "project:a", "ArrowUp")).toBe("thread:b1");
    expect(treeRowIdForKey(rows, "thread:a1", "Home")).toBe("project:a");
    expect(treeRowIdForKey(rows, "thread:a1", "End")).toBe("thread:b1");
  });

  it("falls back to the edge row when no row is active", () => {
    expect(treeRowIdForKey(rows, undefined, "ArrowDown")).toBe("project:a");
    expect(treeRowIdForKey(rows, undefined, "ArrowUp")).toBe("thread:b1");
  });
});

function TreeHarness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeRowId, setActiveRowId] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const collapseProject = vi.fn((rowId: string) => {
    setCollapsed((current) =>
      new Set(current).add(rowId.replace(/^project:/, "")),
    );
  });
  const focusRow = useCallback((rowId: string) => {
    setActiveRowId(rowId);
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-tree-row-id="${rowId}"]`)
      ?.focus();
  }, []);
  const projects = [
    { id: "a", title: "Alpha", threads: [{ id: "a1", title: "Thread A1" }] },
    { id: "b", title: "Beta", threads: [{ id: "b1", title: "Thread B1" }] },
  ];
  return (
    <div
      onKeyDown={(event) =>
        handleProjectTreeKeyDown(event.nativeEvent, {
          container: containerRef.current,
          focusRow,
          collapseProject,
          expandProject: (rowId) =>
            setCollapsed((current) => {
              const next = new Set(current);
              next.delete(rowId.replace(/^project:/, ""));
              return next;
            }),
        })
      }
      ref={containerRef}
      role="tree"
    >
      {projects.map((project) => {
        const open = !collapsed.has(project.id);
        const projectRowId = `project:${project.id}`;
        return (
          <div data-tree-kind="project" key={project.id}>
            <button
              aria-expanded={open}
              data-tree-kind="project"
              data-tree-level="2"
              data-tree-row-id={projectRowId}
              onClick={() =>
                setCollapsed((c) => {
                  const next = new Set(c);
                  if (open) next.add(project.id);
                  else next.delete(project.id);
                  return next;
                })
              }
              role="treeitem"
              tabIndex={
                activeRowId === projectRowId ||
                (activeRowId === undefined && projects[0]!.id === project.id)
                  ? 0
                  : -1
              }
              type="button"
            >
              {project.title}
            </button>
            {open &&
              project.threads.map((thread) => (
                <button
                  aria-selected={thread.id === "a1"}
                  data-tree-kind="thread"
                  data-tree-level="3"
                  data-tree-row-id={`thread:${thread.id}`}
                  key={thread.id}
                  role="treeitem"
                  tabIndex={activeRowId === `thread:${thread.id}` ? 0 : -1}
                  type="button"
                >
                  {thread.title}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

describe("project/thread tree keyboard (rendered)", () => {
  it("reads visible rows from the rendered tree", () => {
    render(<TreeHarness />);
    const tree = screen.getByRole("tree");
    expect(readVisibleTreeRows(tree)).toEqual([
      { id: "project:a", level: 2, kind: "project" },
      { id: "thread:a1", level: 3, kind: "thread" },
      { id: "project:b", level: 2, kind: "project" },
      { id: "thread:b1", level: 3, kind: "thread" },
    ]);
  });

  it("roves vertically with wrapping and moves roving tabindex", async () => {
    const user = userEvent.setup();
    render(<TreeHarness />);
    const alpha = screen.getByRole("treeitem", { name: "Alpha" });
    expect(alpha).toHaveAttribute("tabIndex", "0");

    alpha.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: "Thread A1" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("treeitem", { name: "Thread B1" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: "Alpha" })).toHaveFocus();
  });

  it("collapses with ArrowLeft, focuses the parent from a thread, and ignores unknown controls", async () => {
    const user = userEvent.setup();
    render(<TreeHarness />);
    const beta = screen.getByRole("treeitem", { name: "Beta" });

    beta.focus();
    await user.keyboard("{ArrowLeft}");
    expect(
      screen.queryByRole("treeitem", { name: "Thread B1" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("treeitem", { name: "Thread B1" }),
    ).toBeInTheDocument();

    screen.getByRole("treeitem", { name: "Thread B1" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(beta).toHaveFocus();
  });
});
