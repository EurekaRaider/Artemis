import { resourceCache } from "../resource-cache.js";

import {
  type CatalogSearchTab,
  type CatalogSearchPhase,
} from "../resource-types.js";

import { type FormEvent } from "react";

import type {
  ArtemisPluginMarketplaceState,
  McpCatalogItem,
  ResourceInstallProgress,
  SkillCatalogItem,
} from "../../../shared/api.js";

interface UseResourceOperationsContext {
  readonly setInstallProgress: import("react").Dispatch<
    import("react").SetStateAction<ResourceInstallProgress | undefined>
  >;
  readonly operationPendingRef: import("react").RefObject<boolean>;
  readonly setOperationPending: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly pendingToggleIdsRef: import("react").RefObject<Set<string>>;
  readonly setPendingToggleIds: import("react").Dispatch<
    import("react").SetStateAction<Set<string>>
  >;
  readonly toggleQueueRef: import("react").RefObject<Promise<void>>;
  readonly catalogSearchRef: import("react").RefObject<HTMLInputElement | null>;
  readonly discoveryOpen: boolean;
  readonly setDiscoveryOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setCatalogQuery: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setCatalogSearchPhase: import("react").Dispatch<
    import("react").SetStateAction<Record<CatalogSearchTab, CatalogSearchPhase>>
  >;
  readonly setSkillResults: import("react").Dispatch<
    import("react").SetStateAction<SkillCatalogItem[]>
  >;
  readonly setMcpResults: import("react").Dispatch<
    import("react").SetStateAction<McpCatalogItem[]>
  >;
  readonly setMarketplaceState: import("react").Dispatch<
    import("react").SetStateAction<ArtemisPluginMarketplaceState | undefined>
  >;
}
export function useResourceOperations(context: UseResourceOperationsContext) {
  const {
    setInstallProgress,
    operationPendingRef,
    setOperationPending,
    setMessage,
    pendingToggleIdsRef,
    setPendingToggleIds,
    toggleQueueRef,
    catalogSearchRef,
    discoveryOpen,
    setDiscoveryOpen,
    setCatalogQuery,
    setCatalogSearchPhase,
    setSkillResults,
    setMcpResults,
    setMarketplaceState,
  } = context;
  function beginInstallation(
    kind: ResourceInstallProgress["kind"],
    resourceId: string,
  ): string {
    const operationId = crypto.randomUUID();
    setInstallProgress({ operationId, kind, resourceId, percent: 0 });
    return operationId;
  }

  function runResourceOperation(operation: () => Promise<void>): void {
    if (operationPendingRef.current) return;
    operationPendingRef.current = true;
    setOperationPending(true);
    let pending: Promise<void>;
    try {
      pending = operation();
    } catch (error) {
      operationPendingRef.current = false;
      setOperationPending(false);
      setMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    void pending
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        operationPendingRef.current = false;
        setOperationPending(false);
      });
  }

  function runToggleOperation(
    id: string,
    operation: () => Promise<void>,
  ): void {
    if (pendingToggleIdsRef.current.has(id)) return;
    pendingToggleIdsRef.current.add(id);
    setPendingToggleIds(new Set(pendingToggleIdsRef.current));
    // Mutations return full snapshots. Serialize saves so an older response
    // cannot undo a newer toggle, while only requested rows become busy.
    toggleQueueRef.current = toggleQueueRef.current
      .then(async () => {
        await operation();
        window.dispatchEvent(new Event("artemis:resources-changed"));
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        pendingToggleIdsRef.current.delete(id);
        setPendingToggleIds(new Set(pendingToggleIdsRef.current));
      });
  }

  function runResourceSubmit(
    event: FormEvent,
    operation: () => Promise<void>,
  ): void {
    event.preventDefault();
    runResourceOperation(operation);
  }

  function focusCatalogSearch(): void {
    requestAnimationFrame(() => catalogSearchRef.current?.focus());
  }

  function toggleCatalogDiscovery(tab: CatalogSearchTab): void {
    const opening = !discoveryOpen;
    setDiscoveryOpen(opening);
    setCatalogQuery("");
    setCatalogSearchPhase((current) => ({ ...current, [tab]: "idle" }));
    if (tab === "mcp") setMcpResults([]);
    else setSkillResults([]);
    if (opening) focusCatalogSearch();
  }

  function applyMarketplaceState(next: ArtemisPluginMarketplaceState): void {
    resourceCache.marketplaceStateCache = next;
    setMarketplaceState(next);
    const error = next.errors.find(
      (candidate) => candidate.sourceId === next.selectedView,
    )?.message;
    setMessage(error);
  }
  return {
    beginInstallation,
    runResourceOperation,
    runToggleOperation,
    runResourceSubmit,
    focusCatalogSearch,
    toggleCatalogDiscovery,
    applyMarketplaceState,
  };
}
