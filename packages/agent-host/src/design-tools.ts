import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  designContentSchema,
  type DesignToolOperation,
  type DesignInspection,
} from "@artemis/protocol";

export function createDesignTools(
  invoke: (operation: DesignToolOperation) => Promise<unknown>,
) {
  return [
    defineTool({
      name: "design_document",
      label: "Design document",
      description:
        "List or read immutable task-local design revisions. Use design_save_revision to save. Read returns bounded JSON source with nextOffset (character offsets); continue until nextOffset is null. Optionally select variantId and pageId to read one page. Set visual:true with those IDs to view the saved inspection screenshot and errors. Save requires Design workflow and Execute. HTML content is untrusted prototype source. Use the exact baseRevision for edits; conflicts are retained without replacing the head.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("read")]),
        documentId: Type.Optional(Type.String()),
        revisionId: Type.Optional(Type.String()),
        variantId: Type.Optional(Type.String()),
        pageId: Type.Optional(Type.String()),
        visual: Type.Optional(Type.Boolean()),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 48000 })),
      }),
      execute: async (_id, p) => {
        let operation: DesignToolOperation;
        if (p.action === "list") operation = { action: "list" };
        else if (p.action === "read") {
          if (!p.documentId) throw new Error("documentId is required.");
          operation = {
            action: "read",
            documentId: p.documentId,
            ...(p.revisionId ? { revisionId: p.revisionId } : {}),
            ...(p.visual ? { visual: true } : {}),
            ...(p.variantId ? { variantId: p.variantId } : {}),
            ...(p.pageId ? { pageId: p.pageId } : {}),
            ...(p.offset !== undefined ? { offset: p.offset } : {}),
            ...(p.limit !== undefined ? { limit: p.limit } : {}),
          };
        } else throw new Error("Unknown design document action.");
        const result = await invoke(operation);
        const visual = result as Partial<DesignInspection>;
        if (typeof visual?.screenshot === "string") {
          const match = /^data:image\/png;base64,(.+)$/.exec(visual.screenshot);
          if (!match) throw new Error("Saved inspection image is invalid.");
          const { screenshot: _screenshot, ...record } = visual;
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(record) },
              {
                type: "image" as const,
                data: match[1]!,
                mimeType: "image/png",
              },
            ],
            details: record,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "design_save_revision",
      label: "Save design revision",
      description:
        "Save an immutable DesignContent. All three fields operationId, baseRevision and content are required. Use a new UUID operationId for a new edit and reuse it when retrying identical content. For a new document omit documentId and pass baseRevision:null. For an edit provide documentId and the exact baseRevision. content is a JSON string with exactly schemaVersion:1,title,brief,basis:[{path,summary}],interactionNotes,variants:[{id,name,description,pages:[{id,name,html,parameters:[],data:{}}]}]. No defaultVariantId or extra keys. Requires Design workflow and Execute. Conflicts are retained without replacing the current head.",
      parameters: Type.Object({
        operationId: Type.String({ minLength: 1, maxLength: 128 }),
        documentId: Type.Optional(Type.String()),
        baseRevision: Type.Union([Type.String(), Type.Null()]),
        content: Type.String({
          description:
            "JSON-encoded DesignContent; basis must be an array of path/summary objects, parameters an array, and data a flat object.",
        }),
      }),
      execute: async (_id, p) => {
        const result = await invoke({
          action: "save",
          operationId: p.operationId,
          baseRevision: p.baseRevision,
          ...(p.documentId ? { documentId: p.documentId } : {}),
          content: designContentSchema.parse(JSON.parse(p.content)),
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
    defineTool({
      name: "design_preview_check",
      label: "Inspect design preview",
      description:
        "Run the isolated native preview for an exact saved revision; return its screenshot and script errors. Actions target data-design-id attributes (not HTML id). Add data-design-id to every interactive control before saving. Requires Design workflow, Execute, and a vision model.",
      parameters: Type.Object({
        documentId: Type.String(),
        revisionId: Type.String(),
        variantId: Type.String(),
        pageId: Type.String(),
        actions: Type.Optional(
          Type.Array(
            Type.Object({
              kind: Type.Union([Type.Literal("click"), Type.Literal("input")]),
              elementId: Type.String(),
              value: Type.Optional(Type.String({ maxLength: 65536 })),
            }),
            { maxItems: 20 },
          ),
        ),
      }),
      execute: async (_id, p) => {
        const result = (await invoke({
          action: "inspect",
          ...p,
        })) as DesignInspection;
        const { screenshot, ...record } = result;
        const match = /^data:image\/png;base64,(.+)$/.exec(screenshot);
        if (!match) throw new Error("Preview returned an invalid screenshot.");
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(record) },
            { type: "image" as const, data: match[1]!, mimeType: "image/png" },
          ],
          details: record,
        };
      },
    }),
  ];
}
