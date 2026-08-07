import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname } from "node:path";

import { cellValueAsPrimitive } from "@office-kit/xlsx/cell";
import { loadWorkbook, workbookToBytes } from "@office-kit/xlsx/io";
import { fromBuffer } from "@office-kit/xlsx/node";
import {
  addWorksheet,
  createWorkbook,
  iterWorksheets,
} from "@office-kit/xlsx/workbook";
import {
  getMaxCol,
  getMaxRow,
  getRangeValues,
  setCell,
} from "@office-kit/xlsx/worksheet";
import { resolveWorkspacePath } from "@artemis/platform";
import {
  OFFICE_DOCUMENT_PROTOCOL_VERSION,
  officeDocumentCapabilitiesSchema,
  officeDocumentRequestSchema,
  officeDocumentResultSchema,
  type OfficeCellValue,
  type OfficeDocumentContent,
  type OfficeDocumentFormat,
  type OfficeDocumentPatch,
  type OfficeDocumentRequest,
  type OfficeDocumentResult,
} from "@artemis/protocol";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  type IParagraphOptions,
} from "docx";
import { parseOffice, type OfficeContentNode } from "officeparser";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

const OPERATIONS = ["create", "write", "read", "modify", "delete"] as const;

export const OFFICE_DOCUMENT_CAPABILITIES =
  officeDocumentCapabilitiesSchema.parse({
    protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
    platforms: ["win32", "darwin"],
    formats: ["pdf", "excel", "word", "powerpoint"].map((format) => ({
      format,
      operations: OPERATIONS,
      fidelity: "normalized",
    })),
  });

const EXPECTED_EXTENSIONS: Record<OfficeDocumentFormat, string> = {
  pdf: ".pdf",
  excel: ".xlsx",
  word: ".docx",
  powerpoint: ".pptx",
};

const NORMALIZED_WARNING =
  "The portable Office contract preserves normalized content, not macros, embedded objects, advanced formulas, animations, or complex formatting.";

type PdfContent = Extract<OfficeDocumentContent, { format: "pdf" }>;
type ExcelContent = Extract<OfficeDocumentContent, { format: "excel" }>;
type WordContent = Extract<OfficeDocumentContent, { format: "word" }>;
type PowerPointContent = Extract<
  OfficeDocumentContent,
  { format: "powerpoint" }
>;

function assertExtension(format: OfficeDocumentFormat, path: string): void {
  const expected = EXPECTED_EXTENSIONS[format];
  if (extname(path).toLowerCase() !== expected) {
    throw new Error(
      `The ${format} document extension must be ${expected}: ${path}`,
    );
  }
}

function result(
  request: OfficeDocumentRequest,
  input: {
    changed: boolean;
    content?: OfficeDocumentContent;
    warnings?: string[];
  },
): OfficeDocumentResult {
  return officeDocumentResultSchema.parse({
    protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    format: request.format,
    path: request.path,
    changed: input.changed,
    content: input.content,
    warnings: input.warnings ?? [],
  });
}

async function replaceFile(path: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const backupPath = `${path}.${randomUUID()}.bak`;
  let originalMoved = false;
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    await rename(path, backupPath);
    originalMoved = true;
    await rename(temporaryPath, path);
    await rm(backupPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (originalMoved) {
      await rm(path, { force: true });
      await rename(backupPath, path);
    }
    throw error;
  }
}

function excelColumnName(column: number): string {
  let current = column;
  let name = "";
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

function normalizedCellValue(value: unknown): OfficeCellValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

async function readExcel(path: string): Promise<ExcelContent> {
  const workbook = await loadWorkbook(fromBuffer(await readFile(path)));
  const sheets = [...iterWorksheets(workbook)].map((sheet) => {
    const maxRow = getMaxRow(sheet);
    const maxColumn = getMaxCol(sheet);
    if (maxRow === 0 || maxColumn === 0) {
      return { name: sheet.title, rows: [] };
    }

    const rows = getRangeValues(
      sheet,
      `A1:${excelColumnName(maxColumn)}${maxRow}`,
    ).map((row) =>
      row.map((value) =>
        value === null
          ? null
          : normalizedCellValue(cellValueAsPrimitive(value)),
      ),
    );
    return { name: sheet.title, rows };
  });

  return { format: "excel", sheets };
}

async function writeExcel(content: ExcelContent): Promise<Uint8Array> {
  const workbook = createWorkbook();
  for (const sheetContent of content.sheets) {
    const sheet = addWorksheet(workbook, sheetContent.name);
    for (const [rowIndex, row] of sheetContent.rows.entries()) {
      for (const [columnIndex, value] of row.entries()) {
        if (value !== null) {
          setCell(sheet, rowIndex + 1, columnIndex + 1, value);
        }
      }
    }
  }
  return workbookToBytes(workbook);
}

function headingFor(level: number | undefined): IParagraphOptions["heading"] {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    case 6:
      return HeadingLevel.HEADING_6;
    default:
      return undefined;
  }
}

async function writeWord(content: WordContent): Promise<Uint8Array> {
  const document = new Document({
    sections: [
      {
        children: content.paragraphs.map((paragraph) => {
          const heading = headingFor(paragraph.heading);
          return new Paragraph({
            text: paragraph.text,
            ...(heading ? { heading } : {}),
          });
        }),
      },
    ],
  });
  return Packer.toBuffer(document);
}

function nodeText(node: OfficeContentNode): string {
  if (typeof node.text === "string") {
    return node.text;
  }
  return (node.children ?? []).map(nodeText).join("");
}

async function parseStructuredDocument(
  path: string,
): Promise<{ content: OfficeContentNode[]; warnings: string[] }> {
  const warnings: string[] = [];
  const parsed = await parseOffice(path, {
    decompressionLimits: {
      maxUncompressedBytes: 128 * 1024 * 1024,
      maxZipEntries: 5_000,
      maxTableCells: 1_000_000,
    },
    extractAttachments: false,
    ignoreComments: true,
    ignoreHeadersAndFooters: true,
    ignoreNotes: true,
    ignoreSlideMasters: true,
    includeRawContent: false,
    ocr: false,
    onWarning: (warning) => {
      if (warnings.length < 100) {
        warnings.push(warning.message.slice(0, 2_000));
      }
    },
  });
  return { content: parsed.content, warnings };
}

async function readWord(
  path: string,
): Promise<{ content: WordContent; warnings: string[] }> {
  const parsed = await parseStructuredDocument(path);
  const paragraphs = parsed.content
    .filter((node) => node.type === "paragraph" || node.type === "heading")
    .map((node) => {
      const heading =
        node.type === "heading" ? node.metadata?.level : undefined;
      return {
        text: nodeText(node),
        ...(typeof heading === "number" && heading >= 1 && heading <= 6
          ? { heading }
          : {}),
      };
    });
  return {
    content: { format: "word", paragraphs },
    warnings: parsed.warnings,
  };
}

function linesForPdf(
  text: string,
  font: PDFFont,
  fontSize: number,
  maximumWidth: number,
): string[] {
  const output: string[] = [];
  for (const sourceLine of text.split(/\r?\n/u)) {
    if (sourceLine.length === 0) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of sourceLine.split(/\s+/u)) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      try {
        if (
          line.length === 0 ||
          font.widthOfTextAtSize(candidate, fontSize) <= maximumWidth
        ) {
          line = candidate;
        } else {
          output.push(line);
          line = word;
        }
      } catch {
        throw new Error(
          "PDF creation currently accepts WinAnsi text only; use Word, Excel, or PowerPoint for Unicode content.",
        );
      }
    }
    output.push(line);
  }
  return output;
}

async function writePdf(content: PdfContent): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = 12;
  const margin = 50;
  const lineHeight = 16;

  for (const pageContent of content.pages) {
    const page = document.addPage([
      pageContent.width ?? 595.28,
      pageContent.height ?? 841.89,
    ]);
    const lines = linesForPdf(
      pageContent.text,
      font,
      fontSize,
      page.getWidth() - margin * 2,
    );
    if (lines.length * lineHeight > page.getHeight() - margin * 2) {
      throw new Error(
        "PDF page text does not fit the requested page; split it into additional pages.",
      );
    }
    let y = page.getHeight() - margin;
    for (const line of lines) {
      page.drawText(line, { x: margin, y, font, size: fontSize });
      y -= lineHeight;
    }
  }

  return document.save();
}

async function readPdf(
  path: string,
): Promise<{ content: PdfContent; warnings: string[] }> {
  const parsed = await parseStructuredDocument(path);
  const pages = parsed.content
    .filter((node) => node.type === "page")
    .map((page) => ({ text: nodeText(page) }));
  return {
    content: { format: "pdf", pages },
    warnings: parsed.warnings,
  };
}

async function writePowerPoint(
  content: PowerPointContent,
): Promise<Uint8Array> {
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";

  for (const slideContent of content.slides) {
    const slide = presentation.addSlide();
    if (slideContent.title) {
      slide.addText(slideContent.title, {
        x: 0.7,
        y: 0.45,
        w: 11.9,
        h: 0.6,
        bold: true,
        fontSize: 28,
        margin: 0,
      });
    }
    if (slideContent.body.length > 0) {
      slide.addText(slideContent.body.join("\n"), {
        x: 0.85,
        y: 1.4,
        w: 11.5,
        h: 5.2,
        breakLine: false,
        fontSize: 18,
        margin: 0,
        valign: "top",
      });
    }
  }

  const output = await presentation.write({
    compression: true,
    outputType: "nodebuffer",
  });
  if (typeof output === "string" || output instanceof Blob) {
    throw new Error("PowerPoint generator returned an unsupported output type");
  }
  return new Uint8Array(output);
}

async function readPowerPoint(
  path: string,
): Promise<{ content: PowerPointContent; warnings: string[] }> {
  const parsed = await parseStructuredDocument(path);
  const slides = parsed.content
    .filter((node) => node.type === "slide")
    .map((slide) => {
      const lines = (slide.children ?? [])
        .filter(
          (node) =>
            node.type === "paragraph" ||
            node.type === "heading" ||
            node.type === "text",
        )
        .map(nodeText)
        .filter((text) => text.length > 0);
      return {
        ...(lines[0] ? { title: lines[0] } : {}),
        body: lines.slice(1),
      };
    });
  return {
    content: { format: "powerpoint", slides },
    warnings: parsed.warnings,
  };
}

async function encode(content: OfficeDocumentContent): Promise<Uint8Array> {
  switch (content.format) {
    case "pdf":
      return writePdf(content);
    case "excel":
      return writeExcel(content);
    case "word":
      return writeWord(content);
    case "powerpoint":
      return writePowerPoint(content);
  }
}

async function decode(
  format: OfficeDocumentFormat,
  path: string,
): Promise<{ content: OfficeDocumentContent; warnings: string[] }> {
  switch (format) {
    case "pdf":
      return readPdf(path);
    case "excel":
      return { content: await readExcel(path), warnings: [] };
    case "word":
      return readWord(path);
    case "powerpoint":
      return readPowerPoint(path);
  }
}

function replaceText(
  source: string,
  find: string,
  replacement: string,
  all: boolean,
): { text: string; count: number } {
  if (all) {
    const parts = source.split(find);
    return {
      text: parts.join(replacement),
      count: Math.max(0, parts.length - 1),
    };
  }
  const index = source.indexOf(find);
  if (index < 0) {
    return { text: source, count: 0 };
  }
  return {
    text:
      source.slice(0, index) + replacement + source.slice(index + find.length),
    count: 1,
  };
}

function applyReplaceText(
  content: OfficeDocumentContent,
  patch: Extract<OfficeDocumentPatch, { type: "replace-text" }>,
): number {
  let replacements = 0;
  const apply = (text: string): string => {
    if (!patch.all && replacements > 0) {
      return text;
    }
    const replaced = replaceText(
      text,
      patch.find,
      patch.replacement,
      patch.all,
    );
    replacements += replaced.count;
    return replaced.text;
  };

  switch (content.format) {
    case "pdf":
      content.pages.forEach((page) => {
        page.text = apply(page.text);
      });
      break;
    case "excel":
      content.sheets.forEach((sheet) => {
        sheet.rows.forEach((row) => {
          row.forEach((value, column) => {
            if (typeof value === "string") {
              row[column] = apply(value);
            }
          });
        });
      });
      break;
    case "word":
      content.paragraphs.forEach((paragraph) => {
        paragraph.text = apply(paragraph.text);
      });
      break;
    case "powerpoint":
      content.slides.forEach((slide) => {
        if (slide.title) {
          slide.title = apply(slide.title);
        }
        slide.body = slide.body.map(apply);
      });
      break;
  }
  return replacements;
}

function applyPatch(
  content: OfficeDocumentContent,
  patch: OfficeDocumentPatch,
): number {
  if (patch.type === "replace-text") {
    return applyReplaceText(content, patch);
  }
  if (content.format !== "excel") {
    throw new Error("The set-cell patch is only valid for Excel documents");
  }
  const sheet = content.sheets.find((entry) => entry.name === patch.sheet);
  if (!sheet) {
    throw new Error(`Excel sheet was not found: ${patch.sheet}`);
  }
  while (sheet.rows.length < patch.row) {
    sheet.rows.push([]);
  }
  const row = sheet.rows[patch.row - 1]!;
  while (row.length < patch.column) {
    row.push(null);
  }
  row[patch.column - 1] = patch.value;
  return 1;
}

export class OfficeDocumentService {
  public constructor(private readonly workspacePath: string) {}

  public async execute(
    input: OfficeDocumentRequest,
  ): Promise<OfficeDocumentResult> {
    const request = officeDocumentRequestSchema.parse(input);
    assertExtension(request.format, request.path);
    const absolutePath = resolveWorkspacePath(this.workspacePath, request.path);

    switch (request.operation) {
      case "create": {
        const bytes = await encode(request.content);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, bytes, {
          flag: "wx",
        });
        return result(request, {
          changed: true,
          warnings: [NORMALIZED_WARNING],
        });
      }
      case "write": {
        if (!(await stat(absolutePath)).isFile()) {
          throw new Error(
            `Office document path is not a file: ${request.path}`,
          );
        }
        await replaceFile(absolutePath, await encode(request.content));
        return result(request, {
          changed: true,
          warnings: [NORMALIZED_WARNING],
        });
      }
      case "read": {
        const parsed = await decode(request.format, absolutePath);
        return result(request, {
          changed: false,
          content: parsed.content,
          warnings: parsed.warnings,
        });
      }
      case "modify": {
        const parsed = await decode(request.format, absolutePath);
        const changed = applyPatch(parsed.content, request.patch) > 0;
        if (changed) {
          await replaceFile(absolutePath, await encode(parsed.content));
        }
        return result(request, {
          changed,
          content: parsed.content,
          warnings: [
            ...parsed.warnings,
            ...(changed
              ? [NORMALIZED_WARNING]
              : ["The requested modification did not match any content."]),
          ],
        });
      }
      case "delete":
        await unlink(absolutePath);
        return result(request, { changed: true });
    }
  }
}
