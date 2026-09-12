import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const designParameterSchema = z.union([
  z
    .object({
      name: z.string().regex(/^--design-[a-z][a-z0-9-]{0,63}$/),
      kind: z.literal("number").optional(),
      min: z.number().finite(),
      max: z.number().finite(),
      value: z.number().finite(),
      unit: z.enum(["px", ""]),
    })
    .strict(),
  z
    .object({
      name: z.string().regex(/^--design-[a-z][a-z0-9-]{0,63}$/),
      kind: z.literal("color"),
      value: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .strict(),
]);
export type DesignParameter = z.infer<typeof designParameterSchema>;
export const designPageSchema = z
  .object({
    id,
    name: z.string().min(1).max(160),
    html: z.string().max(2 * 1024 * 1024),
    parameters: z.array(designParameterSchema).max(128),
    data: z
      .record(
        z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/),
        z.union([z.string().max(65536), z.number().finite(), z.boolean()]),
      )
      .default({}),
  })
  .strict();
export const designContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1).max(160),
    brief: z.string().max(32000),
    basis: z
      .array(
        z
          .object({ path: z.string().max(2048), summary: z.string().max(4000) })
          .strict(),
      )
      .max(100),
    interactionNotes: z.string().max(16000),
    variants: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(160),
            description: z.string().max(4000),
            pages: z.array(designPageSchema).min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type DesignContent = z.infer<typeof designContentSchema>;
export type DesignPage = z.infer<typeof designPageSchema>;
export type DesignWorkflow = "code" | "design";
export interface DesignRef {
  documentId: string;
  revisionId: string;
  variantId: string;
  pageIds: string[];
}
export interface DesignRevision {
  documentId: string;
  revisionId: string;
  parentRevision: string | null;
  conflict: boolean;
  digest: string;
  createdAt: string;
  content: DesignContent;
}
export interface DesignSummary {
  documentId: string;
  title: string;
  revisionId: string;
  updatedAt: string;
}
export type DesignPatch =
  | { type: "text"; elementId: string; text: string }
  | { type: "parameter"; name: string; value: string | number }
  | { type: "style"; elementId: string; property: string; value: string }
  | { type: "binding"; key: string; value: string | number | boolean }
  | { type: "move"; elementId: string; parentId: string; beforeId?: string }
  | { type: "image"; elementId: string; dataUrl: string };
export interface DesignSelection {
  elementId: string;
  tag: string;
  text: string;
  editable: boolean;
  reason?: string;
}
export interface DesignPreviewState {
  instanceId: string;
  revisionId: string;
  variantId: string;
  pageId: string;
  status: "running" | "stopped" | "failed";
  error?: string;
  draft?: boolean;
  selection?: DesignSelection;
  errors: string[];
}
export interface DesignInspection {
  revisionId: string;
  variantId: string;
  pageId: string;
  passed: boolean;
  errors: string[];
  screenshot: string;
}
export interface DesignQueuedRequest {
  requestId: string;
  turnId: string;
  threadId: string;
  projectId: string;
  workspaceBinding: string;
  workflow: DesignWorkflow;
  mode: "plan" | "review" | "execute";
  text: string;
  attachments?: import("./schema.js").PromptAttachment[];
  designRef?: DesignRef;
  source?: "user" | "goal-continuation";
  expectedGoalId?: string;
  status:
    | "pending"
    | "dispatched"
    | "completed"
    | "failed"
    | "cancelled"
    | "needs-reconciliation"
    | "paused";
  error?: string;
}
export type DesignToolOperation =
  | { action: "list" }
  | {
      action: "read";
      documentId: string;
      revisionId?: string;
      variantId?: string;
      pageId?: string;
      visual?: boolean;
      offset?: number;
      limit?: number;
    }
  | {
      action: "save";
      operationId: string;
      documentId?: string;
      baseRevision: string | null;
      content: DesignContent;
    }
  | {
      action: "inspect";
      documentId: string;
      revisionId: string;
      variantId: string;
      pageId: string;
      actions?: Array<{
        kind: "click" | "input";
        elementId: string;
        value?: string;
      }>;
    };

export const DESIGN_WORKFLOW_INSTRUCTIONS = `You are in Artemis Design workflow. Do not implement project code yet.
Read DESIGN.md, relevant tokens and components before generating. Record the actual files and a concise summary in basis. Use the existing design system unless the current request changes it.
Use design_document to list/read local designs and design_save_revision to save. For every save provide operationId, baseRevision (null for a new document), and content as a JSON string. basis is an array of {path,summary} objects; do not add undeclared fields such as defaultVariantId. Save schemaVersion 1 content with title, brief, basis, interactionNotes and variants. Each variant has id,name,description,pages; each page has id,name,html,parameters,data. Exploration defaults to three meaningfully different variants; small edits use one. Maximum six variants and ten pages each. HTML/CSS/JavaScript must be self-contained and use simulated data. No external network, workers, eval, nested frames, login, or real submissions.
Give every interactive control a unique data-design-id; preview action elementId refers to this attribute, not the HTML id. Declare editable static leaf text with unique data-design-id and data-design-text="static". Never modify these nodes from prototype scripts. Numeric CSS parameters declare name (--design-*),min,max,value,unit (px or empty); color parameters declare kind:"color",name,value (#RRGGBB). Use the variables in CSS. data-design-bind="key" binds a leaf to the page's flat JSON data map; scripts must not own those nodes. Structural editing requires data-design-container on a static container and stable IDs on its children. Use data-design-page="pageId" for simulated page transitions.
Changes must use the exact baseRevision; preserve all other variants/pages. If saving returns conflict, report both revisions; never overwrite a newer result.
After saving, call design_preview_check for the actual saved revision and each relevant page. Inspect screenshot and script errors and exercise relevant controls. A failed check is not a validated design. Tell the user which behaviors are simulated. Implementation is initiated only by the trusted Design panel's selected-version action.`;

export interface DesignSourceEntry {
  id: string;
  tag: string;
  line: number;
  text: string;
  editable: boolean;
  container: boolean;
  binding?: string | undefined;
  parentId?: string | undefined;
}
export interface DesignPanelState {
  selectionImage?: import("./schema.js").PromptAttachment;
  sources?: Record<string, Record<string, DesignSourceEntry[]>>;
  thumbnails?: Array<{
    variantId: string;
    pageId: string;
    dataUrl: string;
    passed: boolean;
  }>;
  workflow: DesignWorkflow;
  documents: DesignSummary[];
  requests: DesignQueuedRequest[];
  revision?: DesignRevision;
  history?: Array<Omit<DesignRevision, "content">>;
  preview?: DesignPreviewState;
}
export type DesignPanelAction =
  | { action: "selection-image"; instanceId: string }
  | { action: "reorder"; requestIds: string[] }
  | {
      action: "draft-preview";
      documentId: string;
      baseRevision: string;
      variantId: string;
      pageId: string;
      patches: DesignPatch[];
    }
  | {
      action: "patch";
      operationId: string;
      documentId: string;
      baseRevision: string;
      variantId: string;
      pageId: string;
      patches: DesignPatch[];
    }
  | { action: "read"; documentId: string; revisionId?: string }
  | {
      action: "save";
      operationId: string;
      documentId?: string;
      baseRevision: string | null;
      content: DesignContent;
    }
  | {
      action: "preview" | "inspect";
      documentId: string;
      revisionId: string;
      variantId: string;
      pageId: string;
    }
  | { action: "stop" }
  | { action: "export"; instanceId: string }
  | { action: "workflow"; workflow: DesignWorkflow }
  | { action: "implement"; requestId: string; ref: DesignRef }
  | { action: "cancel" | "retry"; requestId: string }
  | { action: "edit-request"; requestId: string; text: string };
