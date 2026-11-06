import type { PromptAttachment, PromptImage } from "@artemis/protocol";

export interface AttachmentsApi {
  onAttachmentImportProgress(
    listener: (progress: AttachmentImportProgress) => void,
  ): () => void;
  retryPromptAttachment(id: string): Promise<PromptAttachment>;
  previewPromptFile(
    id: string,
    offset?: number,
    threadId?: string,
  ): Promise<AttachmentFilePreview>;
  previewPromptAttachment(id: string, threadId?: string): Promise<PromptImage>;
  cancelPromptAttachment(id: string): Promise<void>;
  preparePromptAttachment(
    id: string,
  ): Promise<import("@artemis/protocol").PromptAttachmentReference>;
  selectPromptAttachments(): Promise<AttachmentImportResponse | undefined>;
  readPromptAttachments(files: File[]): Promise<AttachmentImportResponse>;
  readTaskSourceImage(threadId: string, sourceId: string): Promise<PromptImage>;
}

export interface AttachmentImportProgress {
  id: string;
  name: string;
  status: "queued" | "saving" | "saved" | "error";
  copied: number;
  total: number;
  error?: string;
}

export interface AttachmentImportResult {
  attachments: PromptAttachment[];
  errors: string[];
}

export type AttachmentImportResponse =
  PromptAttachment[] | AttachmentImportResult;

export interface AttachmentFilePreview {
  name: string;
  text: string;
  nextOffset?: number | undefined;
}
