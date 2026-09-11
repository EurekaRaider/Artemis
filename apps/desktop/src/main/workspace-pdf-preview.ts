import { randomUUID } from "node:crypto";
import type { WorkspaceFileContent } from "../shared/api.js";

export const WORKSPACE_PDF_SCHEME = "artemis-pdf";

// Opaque, session-only URLs expose just the explicitly opened document. The
// reader revalidates the active task and workspace boundary on every request.
export class WorkspacePdfPreview {
  private readonly documents = new Map<
    string,
    { threadId: string; path: string }
  >();

  constructor(
    private readonly read: (
      threadId: string,
      path: string,
    ) => Promise<WorkspaceFileContent>,
  ) {}

  open(threadId: string, path: string): string {
    for (const [url, document] of this.documents) {
      if (document.threadId === threadId && document.path === path) return url;
    }
    const url = `${WORKSPACE_PDF_SCHEME}://document/${randomUUID()}/${encodeURIComponent(path.replaceAll("\\", "/").split("/").at(-1) ?? "document.pdf")}`;
    this.documents.set(url, { threadId, path });
    return url;
  }

  async respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    url.hash = "";
    const document = this.documents.get(url.href);
    if (!document || !["GET", "HEAD"].includes(request.method)) {
      return new Response(null, { status: 404 });
    }
    try {
      const file = await this.read(document.threadId, document.path);
      if (file.preview?.mimeType !== "application/pdf")
        return new Response(null, { status: 415 });
      const bytes = Buffer.from(file.preview.data, "base64");
      return new Response(request.method === "HEAD" ? null : bytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(bytes.length),
          "Content-Disposition": "inline",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }
}
