import { appCopy } from "../app-copy.js";
import {
  type ToastContent,
  type FileLinkContextMenuState,
} from "../app-types.js";

import { useCallback, useEffect, type SetStateAction } from "react";

import type { WorkspaceFileLink } from "../../../shared/api.js";

import { normalizeBrowserAddress } from "../browser-navigation.js";

import {
  type WorkspaceTabKind,
  type WorkspaceTabOpenOptions,
} from "../../workspace/workspace-tabs.js";

interface UseConversationLinksContext {
  readonly activeThreadId: string | undefined;
  readonly activeThreadIdRef: import("react").RefObject<string | undefined>;
  readonly openResolvedWorkspaceFile: (file: WorkspaceFileLink) => void;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly locale: import("@artemis/protocol").AppLocale;
  readonly openWorkspaceTab: (
    kind: WorkspaceTabKind,
    options?: WorkspaceTabOpenOptions,
  ) => void;
  readonly setFileLinkContextMenu: import("react").Dispatch<
    import("react").SetStateAction<FileLinkContextMenuState | undefined>
  >;
  readonly t: ReturnType<typeof appCopy>;
  readonly fileLinkContextMenu: FileLinkContextMenuState | undefined;
}
export function useConversationLinks(context: UseConversationLinksContext) {
  const {
    activeThreadId,
    activeThreadIdRef,
    openResolvedWorkspaceFile,
    setToast,
    locale,
    openWorkspaceTab,
    setFileLinkContextMenu,
    t,
    fileLinkContextMenu,
  } = context;
  const openConversationFileLink = useCallback(
    async (href: string) => {
      const threadId = activeThreadId;
      if (!threadId) return;
      try {
        const file = await window.artemis.inspectWorkspaceFileLink(
          threadId,
          href,
        );
        if (activeThreadIdRef.current !== threadId) return;
        openResolvedWorkspaceFile(file);
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeThreadId, openResolvedWorkspaceFile],
  );

  const openConversationExternalLink = useCallback(
    (href: string) => {
      try {
        const url = normalizeBrowserAddress(href, locale);
        openWorkspaceTab("browser", { reuseKind: true, url });
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [openWorkspaceTab],
  );

  const openConversationFileLinkMenu = useCallback(
    async (href: string, position: { x: number; y: number }) => {
      const threadId = activeThreadId;
      if (!threadId) return;
      setFileLinkContextMenu(undefined);
      try {
        const file = await window.artemis.inspectWorkspaceFileLink(
          threadId,
          href,
        );
        if (activeThreadIdRef.current !== threadId) return;
        const menuWidth = 208;
        const menuHeight = file.executable ? 122 : 84;
        setFileLinkContextMenu({
          file,
          threadId,
          x: Math.max(
            8,
            Math.min(position.x, window.innerWidth - menuWidth - 8),
          ),
          y: Math.max(
            8,
            Math.min(position.y, window.innerHeight - menuHeight - 8),
          ),
        });
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeThreadId],
  );

  const revealConversationFile = useCallback(
    async (menu: FileLinkContextMenuState) => {
      setFileLinkContextMenu(undefined);
      try {
        await window.artemis.revealWorkspaceFile(menu.threadId, menu.file.path);
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  const runConversationFile = useCallback(
    async (menu: FileLinkContextMenuState) => {
      setFileLinkContextMenu(undefined);
      try {
        await window.artemis.runWorkspaceFile(menu.threadId, menu.file.path);
        setToast(`${t.runLinkedFileStarted}: ${menu.file.path}`);
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [t.runLinkedFileStarted],
  );

  useEffect(() => {
    setFileLinkContextMenu(undefined);
  }, [activeThreadId]);

  useEffect(() => {
    if (!fileLinkContextMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFileLinkContextMenu(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [fileLinkContextMenu]);
  return {
    openConversationFileLink,
    openConversationExternalLink,
    openConversationFileLinkMenu,
    revealConversationFile,
    runConversationFile,
  };
}
