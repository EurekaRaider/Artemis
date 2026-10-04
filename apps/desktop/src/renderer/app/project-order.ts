export type ProjectDropEdge = "before" | "after";

interface ProjectOrderPersistenceQueueOptions {
  save(order: string[]): Promise<string[]>;
  onPersisted(order: string[]): void;
  onRejected(order: string[], error: unknown): void;
}

export interface ProjectOrderPersistenceQueue {
  initialize(order: readonly string[]): void;
  persist(
    order: readonly string[],
    previousOrder: readonly string[],
  ): Promise<void>;
}

export function createProjectOrderPersistenceQueue({
  save,
  onPersisted,
  onRejected,
}: ProjectOrderPersistenceQueueOptions): ProjectOrderPersistenceQueue {
  let persistence = Promise.resolve();
  let persistedOrder: string[] = [];
  let hasBaseline = false;
  let latestRevision = 0;

  return {
    initialize(order) {
      if (latestRevision > 0) return;
      persistedOrder = [...order];
      hasBaseline = true;
    },
    persist(order, previousOrder) {
      if (!hasBaseline) {
        persistedOrder = [...previousOrder];
        hasBaseline = true;
      }
      const requestedOrder = [...order];
      const revision = ++latestRevision;
      persistence = persistence.then(async () => {
        try {
          const savedOrder = await save(requestedOrder);
          persistedOrder = [...savedOrder];
          if (revision === latestRevision) onPersisted([...savedOrder]);
        } catch (error) {
          if (revision === latestRevision) {
            onRejected([...persistedOrder], error);
          }
        }
      });
      return persistence;
    },
  };
}

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
