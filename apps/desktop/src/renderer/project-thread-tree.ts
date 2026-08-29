export interface VisibleTreeRow {
  id: string;
  level: number;
  kind: "collection" | "project" | "thread" | "show-more" | "temporary";
}

export type TreeRowVerticalKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

/**
 * Read the visible rows from the rendered tree container. The DOM is the
 * single source of truth for visibility (open projects, filtered threads),
 * so roving can never drift from what is actually rendered.
 */
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
      level: Number(element.dataset.treeLevel),
      kind: (element.dataset.treeKind ?? "thread") as VisibleTreeRow["kind"],
    }));
}

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

function rowElement(
  container: HTMLElement | null,
  rowId: string,
): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>(
      `[data-tree-row-id="${CSS.escape(rowId)}"]`,
    ) ?? null
  );
}

function parentRowId(
  container: HTMLElement | null,
  rowId: string,
): string | undefined {
  return rowElement(container, rowId)?.parentElement?.closest<HTMLElement>(
    "[data-tree-row-id]",
  )?.dataset.treeRowId;
}

/**
 * Keydown handler for the project/thread tree (WAI-ARIA Treeview). The tree
 * is a single `role="tree"` whose rows are `role="treeitem"` containers;
 * interactive controls inside a row are embedded widgets that keep native
 * Tab reachability, so activation is only honoured when the treeitem itself
 * has focus. ArrowLeft collapses an expanded branch / focuses the parent
 * from a leaf or a collapsed branch; ArrowRight expands a collapsed branch
 * or moves focus to the first child of an expanded one. Vertical keys are
 * consumed at the edges so the browser never scrolls (WAI-ARIA: no action
 * at a boundary still means preventDefault).
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
    collapseRow: (rowId: string) => void;
    expandRow: (rowId: string) => void;
    activateRow: (rowId: string) => void;
  },
): void {
  const rowId = rowIdFromEventTarget(event.target);
  if (!rowId) return;
  const rows = readVisibleTreeRows(deps.container);
  const row = rows.find((candidate) => candidate.id === rowId);
  if (!row) return;
  // Tree navigation applies only while the treeitem itself has focus.
  // Embedded widgets (the rename input, buttons, menus) keep their native
  // key behaviour: arrow keys move the caret instead of the roving focus,
  // and Home/End stay text-editing keys instead of row jumps.
  if (event.target !== rowElement(deps.container, rowId)) return;

  if (
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    event.key === "Home" ||
    event.key === "End"
  ) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // Consume the key at the edges too so the browser never scrolls.
      event.preventDefault();
      const nextId = treeRowIdForKey(rows, rowId, event.key);
      if (nextId) deps.focusRow(nextId);
      return;
    }
    const nextId = treeRowIdForKey(rows, rowId, event.key);
    if (!nextId) return;
    event.preventDefault();
    deps.focusRow(nextId);
    return;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (row.kind === "thread" || row.kind === "show-more") {
      // Leaf rows: Left focuses the parent branch, Right does nothing.
      // Either way the key is consumed so the sidebar never scrolls.
      event.preventDefault();
      if (event.key === "ArrowLeft") {
        const parentId = parentRowId(deps.container, rowId);
        if (parentId) deps.focusRow(parentId);
      }
      return;
    }
    const expanded = rowElement(deps.container, rowId)?.getAttribute(
      "aria-expanded",
    );
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (expanded === "true") {
        deps.collapseRow(rowId);
        return;
      }
      if (expanded === "false") {
        const parentId = parentRowId(deps.container, rowId);
        if (parentId) deps.focusRow(parentId);
      }
      return;
    }
    event.preventDefault();
    if (expanded === "false") {
      deps.expandRow(rowId);
      return;
    }
    // Expanded branch: ArrowRight moves focus to the first child row. The
    // visible-row sequence places the first child immediately after its
    // parent row.
    const rowIndex = rows.findIndex((candidate) => candidate.id === rowId);
    const firstChild = rows[rowIndex + 1];
    if (firstChild && firstChild.level > row.level) {
      deps.focusRow(firstChild.id);
    }
    return;
  }

  // Browsers report " " for the space key; some test drivers report
  // "Space" — accept both so activation behaves identically everywhere.
  if (event.key === "Enter" || event.key === " " || event.key === "Space") {
    // show-more rows are buttons: keep their native activation.
    if (row.kind === "show-more") return;
    event.preventDefault();
    deps.activateRow(rowId);
  }
}
