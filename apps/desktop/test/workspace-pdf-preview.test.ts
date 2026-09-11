import { describe, expect, it, vi } from "vitest";
import { WorkspacePdfPreview } from "../src/main/workspace-pdf-preview.js";

describe("private PDF protocol", () => {
  it("serves exact PDF bytes with a PDF MIME type and stable opaque URL", async () => {
    const bytes = Buffer.from("%PDF-1.7\n\u0000\ufffd");
    const read = vi.fn().mockResolvedValue({
      preview: {
        mimeType: "application/pdf",
        data: bytes.toString("base64"),
      },
    });
    const preview = new WorkspacePdfPreview(read);
    const url = preview.open("task", "private/report.pdf");
    expect(url).not.toContain("private");
    expect(preview.open("task", "private/report.pdf")).toBe(url);
    const response = await preview.respond(new Request(url));
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(read).toHaveBeenCalledWith("task", "private/report.pdf");
  });
  it("rejects unissued paths and methods without reading the filesystem", async () => {
    const read = vi.fn();
    const preview = new WorkspacePdfPreview(read);
    const url = preview.open("task", "report.pdf");
    for (const request of [
      new Request("artemis-pdf://document/etc/passwd"),
      new Request(url, { method: "POST" }),
    ]) {
      expect((await preview.respond(request)).status).toBe(404);
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("revalidates the workspace on refresh and does not return filesystem errors", async () => {
    const read = vi.fn().mockRejectedValue(new Error("outside the workspace"));
    const preview = new WorkspacePdfPreview(read);
    expect(
      (await preview.respond(new Request(preview.open("task", "report.pdf"))))
        .status,
    ).toBe(404);
  });
});
