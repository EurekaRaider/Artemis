import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OFFICE_DOCUMENT_PROTOCOL_VERSION,
  type OfficeDocumentContent,
  type OfficeDocumentFormat,
  type OfficeDocumentRequest,
} from "@artemis/protocol";
import { afterEach, describe, expect, it } from "vitest";

import {
  OFFICE_DOCUMENT_CAPABILITIES,
  OfficeDocumentService,
} from "../src/main/office-document-service.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artemis-office-"));
  roots.push(root);
  return root;
}

function request(
  input: Omit<OfficeDocumentRequest, "protocolVersion" | "requestId">,
): OfficeDocumentRequest {
  return {
    protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
    requestId: `request-${Math.random()}`,
    ...input,
  } as OfficeDocumentRequest;
}

const cases: Array<{
  format: OfficeDocumentFormat;
  path: string;
  first: OfficeDocumentContent;
  second: OfficeDocumentContent;
  expectedFirst: string;
  expectedSecond: string;
}> = [
  {
    format: "pdf",
    path: "documents/report.pdf",
    first: { format: "pdf", pages: [{ text: "First PDF" }] },
    second: { format: "pdf", pages: [{ text: "Second PDF" }] },
    expectedFirst: "First PDF",
    expectedSecond: "Second PDF",
  },
  {
    format: "excel",
    path: "documents/report.xlsx",
    first: {
      format: "excel",
      sheets: [{ name: "Summary", rows: [["First Excel", 1]] }],
    },
    second: {
      format: "excel",
      sheets: [{ name: "Summary", rows: [["Second Excel", 2]] }],
    },
    expectedFirst: "First Excel",
    expectedSecond: "Second Excel",
  },
  {
    format: "word",
    path: "documents/report.docx",
    first: { format: "word", paragraphs: [{ text: "First Word" }] },
    second: { format: "word", paragraphs: [{ text: "Second Word" }] },
    expectedFirst: "First Word",
    expectedSecond: "Second Word",
  },
  {
    format: "powerpoint",
    path: "documents/report.pptx",
    first: {
      format: "powerpoint",
      slides: [{ title: "First PowerPoint", body: ["Body"] }],
    },
    second: {
      format: "powerpoint",
      slides: [{ title: "Second PowerPoint", body: ["Body"] }],
    },
    expectedFirst: "First PowerPoint",
    expectedSecond: "Second PowerPoint",
  },
];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("OfficeDocumentService", () => {
  it("advertises one portable contract for Windows and macOS", () => {
    expect(OFFICE_DOCUMENT_CAPABILITIES.platforms).toEqual(["win32", "darwin"]);
    expect(
      OFFICE_DOCUMENT_CAPABILITIES.formats.every(
        (format) => format.operations.length === 5,
      ),
    ).toBe(true);
  });

  it.each(cases)(
    "round-trips all five $format operations",
    async ({ expectedFirst, expectedSecond, first, format, path, second }) => {
      const root = await temporaryRoot();
      const service = new OfficeDocumentService(root);

      await service.execute(
        request({ operation: "create", format, path, content: first }),
      );
      expect((await stat(join(root, path))).isFile()).toBe(true);

      const firstRead = await service.execute(
        request({ operation: "read", format, path }),
      );
      expect(JSON.stringify(firstRead.content)).toContain(expectedFirst);

      await service.execute(
        request({ operation: "write", format, path, content: second }),
      );
      const secondRead = await service.execute(
        request({ operation: "read", format, path }),
      );
      expect(JSON.stringify(secondRead.content)).toContain(expectedSecond);

      await service.execute(
        request({
          operation: "modify",
          format,
          path,
          patch: {
            type: "replace-text",
            find: expectedSecond,
            replacement: `Modified ${format}`,
            all: true,
          },
        }),
      );
      const modified = await service.execute(
        request({ operation: "read", format, path }),
      );
      expect(JSON.stringify(modified.content)).toContain(`Modified ${format}`);

      await service.execute(request({ operation: "delete", format, path }));
      await expect(stat(join(root, path))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("modifies an exact Excel cell without evaluating formulas", async () => {
    const root = await temporaryRoot();
    const service = new OfficeDocumentService(root);
    const path = "documents/data.xlsx";
    await service.execute(
      request({
        operation: "create",
        format: "excel",
        path,
        content: {
          format: "excel",
          sheets: [{ name: "Summary", rows: [["Name", "Before"]] }],
        },
      }),
    );

    await service.execute(
      request({
        operation: "modify",
        format: "excel",
        path,
        patch: {
          type: "set-cell",
          sheet: "Summary",
          row: 1,
          column: 2,
          value: "After",
        },
      }),
    );

    const result = await service.execute(
      request({ operation: "read", format: "excel", path }),
    );
    expect(result.content).toMatchObject({
      format: "excel",
      sheets: [{ name: "Summary", rows: [["Name", "After"]] }],
    });
  });

  it("rejects traversal and mismatched extensions before touching disk", async () => {
    const root = await temporaryRoot();
    const service = new OfficeDocumentService(root);

    await expect(
      service.execute(
        request({
          operation: "read",
          format: "word",
          path: "../outside.docx",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      service.execute(
        request({
          operation: "create",
          format: "word",
          path: "report.pdf",
          content: {
            format: "word",
            paragraphs: [{ text: "Wrong extension" }],
          },
        }),
      ),
    ).rejects.toThrow("extension");
    await expect(readFile(join(root, "report.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
