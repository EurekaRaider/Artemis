export interface AttachmentWork {
  action: "parse" | "image" | "read" | "search";
  id?: string;
  part?: string | undefined;
  name?: string;
  offset?: number | undefined;
  query?: string | undefined;
  maxTokens?: number;
  path: string;
  mimeType: string;
  output?: string;
  page?: number | undefined;
  crop?: { x: number; y: number; width: number; height: number } | undefined;
}
