import {
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";

import { type Thread } from "@artemis/protocol";

interface UseApplicationShortcutsContext {
  readonly beginNewConversation: (projectId?: string | undefined) => void;
  readonly changeSidebarOpen: (
    open: boolean | ((current: boolean) => boolean),
  ) => void;
  readonly sidebarSearchInput: import("react").RefObject<HTMLInputElement | null>;
  readonly toggleTerminalPanel: () => void;
  readonly toggleReviewPanel: () => void;
  readonly setApprovalMenuOpen: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly setModelPickerOpen: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly setThreadArchived: (
    thread: Thread,
    archived: boolean,
    bulk?: boolean,
  ) => Promise<boolean | undefined>;
  readonly beginRenameThread: (thread: Thread) => void;
}
export function useApplicationShortcuts(
  context: UseApplicationShortcutsContext,
) {
  const {
    beginNewConversation,
    changeSidebarOpen,
    sidebarSearchInput,
    toggleTerminalPanel,
    toggleReviewPanel,
    setApprovalMenuOpen,
    setModelPickerOpen,
    setThreadArchived,
    beginRenameThread,
  } = context;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") {
        setApprovalMenuOpen(false);
        setModelPickerOpen(false);
      } else if (modifier && event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleReviewPanel();
      } else if (modifier && event.key.toLowerCase() === "b") {
        event.preventDefault();
        changeSidebarOpen((open) => !open);
      } else if (modifier && event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleTerminalPanel();
      } else if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        changeSidebarOpen(true);
        requestAnimationFrame(() => sidebarSearchInput.current?.focus());
      } else if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        beginNewConversation();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    beginNewConversation,
    changeSidebarOpen,
    toggleReviewPanel,
    toggleTerminalPanel,
  ]);

  const taskShortcut = (
    event: ReactKeyboardEvent<HTMLElement>,
    thread: Thread,
  ) => {
    if (event.key === "F2") {
      event.preventDefault();
      beginRenameThread(thread);
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Backspace" &&
      thread.status !== "running" &&
      thread.status !== "waiting-approval"
    ) {
      event.preventDefault();
      void setThreadArchived(thread, true);
    }
  };
  return { taskShortcut };
}
