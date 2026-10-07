import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";
export const MANAGED_WORKTREE_LIMIT = 10;

// Reservations remain until the caller persists the successfully created worktree.
// This also covers the promise continuation between Git completion and SQLite.
export class WorktreeCapacity {
  constructor(private readonly locale: () => AppLocale = () => "en") {}
  private readonly reservations = new Set<string>();

  release(id: string): void {
    this.reservations.delete(id);
  }

  reserve(id: string, persistedIds: string[]): () => void {
    const existing = new Set(persistedIds);
    for (const reserved of this.reservations) {
      if (existing.has(reserved)) this.reservations.delete(reserved);
    }
    if (existing.has(id) || this.reservations.has(id)) {
      throw new Error(
        "A worktree already exists or is being created for this task.",
      );
    }
    if (existing.size + this.reservations.size >= MANAGED_WORKTREE_LIMIT) {
      throw new Error(
        `WORKTREE_LIMIT: ${uiText(this.locale(), "WorktreeManager.limitReached")}`,
      );
    }
    this.reservations.add(id);
    return () => {
      this.reservations.delete(id);
    };
  }
}
