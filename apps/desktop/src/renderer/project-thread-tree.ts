export interface VisibleTreeRow {
  id: string;
  level: 2 | 3;
  kind: "project" | "thread";
}

export type TreeRowVerticalKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

/**
 * Read the visible rows from the rendered tree container. The DOM is the
 * single source of truth for visibility (open projects, filtered threads),
 * so roving can never drift from what is actually rendered.
 */
/**
 * Clamp the roving state to the rows that actually exist in the DOM: when
 * the remembered row disappeared (collapse, archive, search filter), fall
 * back to the first visible row so the tree always keeps exactly one Tab
 * stop (WAI-ARIA roving tabindex invariant).
 */
export function clampTreeActiveRowId(
  container: HTMLElement | null,
  activeRowId: string | undefined,
): string | undefined {
  const rows = readVisibleTreeRows(container);
  if (rows.length === 0) return undefined;
  return rows.some((row) => row.id === activeRowId) ? activeRowId : rows[0]!.id;
}

export function readVisibleTreeRows(
  container: HTMLElement | null,
): VisibleTreeRow[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-tree-row-id]"),
  )
    .filter((element) => !element.closest("[hidden]"))
    .map((element) => ({
      id: element.dataset.treeRowId!,
      level: Number(element.dataset.treeLevel) === 3 ? 3 : 2,
      kind: element.dataset.treeKind === "thread" ? "thread" : "project",
    }));
}

/**
 * Vertical roving within the visible rows: ArrowUp/ArrowDown do NOT wrap —
 * the first row's ArrowUp and the last row's ArrowDown leave focus
 * unchanged; Home/End address the logical first/last row.
 */
export function treeRowIdForKey(
  rows: readonly VisibleTreeRow[],
  currentId: string | undefined,
  key: TreeRowVerticalKey,
): string | undefined {
  if (rows.length === 0) return undefined;
  if (key === "Home") return rows[0]!.id;
  if (key === "End") return rows[rows.length - 1]!.id;
  const delta = key === "ArrowDown" ? 1 : -1;
  const currentIndex = rows.findIndex((row) => row.id === currentId);
  if (currentIndex < 0) {
    return rows[delta > 0 ? 0 : rows.length - 1]!.id;
  }
  return rows[currentIndex + delta]?.id;
}

function rowIdFromEventTarget(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  const row = target.closest<HTMLElement>("[data-tree-row-id]");
  return row?.dataset.treeRowId ?? null;
}

/**
 * Keydown handler for the project/thread tree. Keys are honoured only when
 * the event originates from a tree row (project toggle or thread select).
 * ArrowLeft collapses an open project row / focuses the parent project from
 * a thread row; ArrowRight expands a collapsed project row.
 */
export function handleProjectTreeKeyDown(
  event: {
    key: string;
    target: EventTarget | null;
    preventDefault(): void;
  },
  deps: {
    container: HTMLElement | null;
    focusRow: (rowId: string) => void;
    collapseProject: (projectId: string) => void;
    expandProject: (projectId: string) => void;
  },
): void {
  const rowId = rowIdFromEventTarget(event.target);
  if (!rowId) return;
  const rows = readVisibleTreeRows(deps.container);
  const row = rows.find((candidate) => candidate.id === rowId);

  if (
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    event.key === "Home" ||
    event.key === "End"
  ) {
    const nextId = treeRowIdForKey(rows, rowId, event.key);
    if (!nextId) return;
    event.preventDefault();
    deps.focusRow(nextId);
    return;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (!row) return;
    if (row.kind === "project") {
      const projectRow = deps.container?.querySelector<HTMLElement>(
        `[data-tree-row-id="${CSS.escape(rowId)}"]`,
      );
      const expanded = projectRow?.getAttribute("aria-expanded");
      if (event.key === "ArrowLeft" && expanded === "true") {
        event.preventDefault();
        deps.collapseProject(rowId);
      } else if (event.key === "ArrowRight") {
        if (expanded === "false") {
          event.preventDefault();
          deps.expandProject(rowId);
          return;
        }
        // Expanded parent: ArrowRight moves focus to the first child row
        // (WAI-ARIA Treeview). The visible-row sequence places the first
        // child immediately after its parent project row.
        const rowIndex = rows.findIndex((candidate) => candidate.id === rowId);
        const firstChild = rows[rowIndex + 1];
        if (firstChild?.kind === "thread") {
          event.preventDefault();
          deps.focusRow(firstChild.id);
        }
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      const parent = deps.container
        ?.querySelector<HTMLElement>(
          `[data-tree-row-id="${CSS.escape(rowId)}"]`,
        )
        ?.closest('[data-tree-kind="project"]');
      const parentId =
        parent?.querySelector<HTMLElement>("[data-tree-row-id]")?.dataset
          .treeRowId;
      if (parentId) {
        event.preventDefault();
        deps.focusRow(parentId);
      }
    }
  }
}
