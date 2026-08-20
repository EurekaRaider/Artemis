export type ProjectDropEdge = "before" | "after";

export function orderProjectsByPreference<TProject extends { id: string }>(
  projects: readonly TProject[],
  preference: readonly string[] | undefined,
): TProject[] {
  if (!preference?.length) return [...projects];

  const preferredIndex = new Map(
    preference.map((projectId, index) => [projectId, index]),
  );
  return projects
    .map((project, index) => ({ index, project }))
    .sort((left, right) => {
      const leftIndex = preferredIndex.get(left.project.id);
      const rightIndex = preferredIndex.get(right.project.id);
      if (leftIndex === undefined && rightIndex === undefined) {
        return left.index - right.index;
      }
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      return leftIndex - rightIndex;
    })
    .map(({ project }) => project);
}

export function reorderProjectIds(
  order: readonly string[],
  draggedProjectId: string,
  targetProjectId: string,
  edge: ProjectDropEdge,
): string[] {
  if (
    draggedProjectId === targetProjectId ||
    !order.includes(draggedProjectId) ||
    !order.includes(targetProjectId)
  ) {
    return [...order];
  }

  const next = order.filter((projectId) => projectId !== draggedProjectId);
  const targetIndex = next.indexOf(targetProjectId);
  next.splice(targetIndex + (edge === "after" ? 1 : 0), 0, draggedProjectId);
  return next;
}
