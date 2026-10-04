import { useCallback, useRef, useState, type SetStateAction } from "react";
import { z } from "zod";
import {
  emptyWorkspaceTabs,
  type WorkspaceTabsState,
} from "./workspace-tabs.js";
import { usePersistentUiState } from "../app/ui-state.js";

const tabSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "review",
    "terminal",
    "browser",
    "file",
    "office",
    "markdown",
    "sources",
    "goal",
    "child-agent",
    "agent-team",
  ]),
  title: z.string(),
  path: z.string().optional(),
  revision: z.string().optional(),
  url: z.string().optional(),
  childAgentId: z.string().optional(),
  agentTeamId: z.string().optional(),
  artifactSessionId: z.string().optional(),
});
const workspaceSchema = z.record(
  z.string(),
  z
    .object({
      tabs: z.array(tabSchema),
      activeTabId: z.string().optional(),
      dockOpen: z.boolean().optional(),
    })
    .transform((state): WorkspaceTabsState => ({
      ...state,
      tabs: state.tabs.map(({ childAgentId, agentTeamId, ...tab }) => ({
        ...tab,
        ...(childAgentId === undefined ? {} : { childAgentId }),
        ...(agentTeamId === undefined ? {} : { agentTeamId }),
      })),
      activeTabId: state.tabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : state.tabs[0]?.id,
    })),
);

export function useWorkspaceUiState(threadId: string | undefined) {
  const [tabsByThread, setTabsByThread] = usePersistentUiState(
    "artemis-workspace-tabs",
    workspaceSchema,
    {},
  );
  const activeThread = useRef(threadId);
  activeThread.current = threadId;
  const [draftDockOpen, setDraftDockOpen] = useState(false);
  const setDockOpen = useCallback(
    (update: SetStateAction<boolean>) => {
      const id = activeThread.current;
      if (!id) {
        setDraftDockOpen(update);
        return;
      }
      setTabsByThread((current) => {
        const state = current[id] ?? emptyWorkspaceTabs();
        const open =
          typeof update === "function"
            ? update(state.dockOpen ?? false)
            : update;
        if (state.dockOpen === open) return current;
        return { ...current, [id]: { ...state, dockOpen: open } };
      });
    },
    [setTabsByThread],
  );
  return {
    tabsByThread,
    setTabsByThread,
    dockOpen: threadId
      ? (tabsByThread[threadId]?.dockOpen ?? false)
      : draftDockOpen,
    setDockOpen,
  };
}
