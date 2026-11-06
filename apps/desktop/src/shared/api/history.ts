import type {
  ConversationShare,
  ShareDestination,
  ShareOptions,
  SharePreview,
} from "../conversation-share.js";
import type {
  ThreadHistoryCursor,
  ThreadHistoryPage,
} from "../thread-history.js";
import type { AgentEvent, AppSnapshot } from "@artemis/protocol";

export interface HistoryApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  onWindowMaterialChanged(
    listener: (
      material: import("../window-material.js").WindowMaterial,
    ) => void,
  ): () => void;
  getThreadHistory(
    threadId: string,
    cursor?: ThreadHistoryCursor,
  ): Promise<ThreadHistoryPage>;
  getThreadEvents(threadId: string): Promise<AgentEvent[]>;
  prepareConversationShare(
    threadId: string,
    options: ShareOptions,
  ): Promise<SharePreview>;
  updateConversationShare(
    previewId: string,
    options: ShareOptions,
    excludedIds: string[],
  ): Promise<SharePreview>;
  uploadConversationShare(
    previewId: string,
    destination: ShareDestination,
  ): Promise<ConversationShare>;
  cancelConversationShare(previewId: string): Promise<void>;
  exportConversationShare(previewId: string): Promise<boolean>;
  listConversationShares(threadId: string): Promise<ConversationShare[]>;
  deleteConversationShare(id: string): Promise<void>;
  getThreadTaskSummary(threadId: string): Promise<string | undefined>;
  getTokenUsageEvents(): Promise<AgentEvent[]>;
  getPromptHistory(): Promise<string[]>;
  rendererReady(): void;
}

export interface DesktopSnapshot extends AppSnapshot {
  userName: string;
  windowMaterial?: import("../window-material.js").WindowMaterial;
}
