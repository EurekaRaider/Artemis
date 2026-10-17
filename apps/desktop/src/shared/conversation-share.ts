export type ShareDestination = "auto" | "gist" | "radius";
export interface ShareOptions {
  tools: boolean;
  thinking: boolean;
  attachments: boolean;
}
export interface SharePreview {
  id: string;
  threadId: string;
  title: string;
  createdAt: string;
  previewUrl: string;
  messages: Array<{
    id: string;
    role: string;
    text: string;
    included: boolean;
  }>;
  options: ShareOptions;
  destinations: { gist: boolean; radius: boolean };
}
export interface ConversationShare {
  id: string;
  threadId: string;
  title: string;
  createdAt: string;
  destination: "gist" | "radius";
  remoteId: string;
  url: string;
}
export type ShareCommand =
  | { type: "prepare"; threadId: string; options: ShareOptions }
  | {
      type: "update";
      previewId: string;
      options: ShareOptions;
      excludedIds: string[];
    }
  | { type: "upload"; previewId: string; destination: ShareDestination }
  | { type: "cancel"; previewId: string }
  | { type: "export"; previewId: string }
  | { type: "list"; threadId: string }
  | { type: "delete"; id: string };
