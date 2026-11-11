import {
  normalizedWritePaths,
  writePathAllowed,
} from "../agent-team-policy.js";

import {
  defineBrokerTool,
  modelApprovalParameter,
  modelApproval,
} from "../broker-tool-parameters.js";

import { type OpenThreadRequest } from "../runtime-types.js";

import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";

import {
  OFFICE_DOCUMENT_PROTOCOL_VERSION,
  officeDocumentRequestSchema,
  officeDocumentFormatForPath,
  artifactSessionRequestSchema,
  type OfficeDocumentResult,
} from "@artemis/protocol";

import type { BrokerToolContext } from "./broker-tool-context.js";
export function createOfficeDocumentToolFactory(
  request: OpenThreadRequest,
  context: Pick<BrokerToolContext, "configuration" | "threads" | "broker">,
) {
  const createOfficeDocumentTool = (
    resolveActor: () => {
      actorAgentId?: string;
      writePaths?: string[];
    },
  ) =>
    defineBrokerTool({
      name: "office_document",
      label: "Office document",
      description:
        "Requires the installed Office suite. Use create/read/write/modify/delete for normalized PDF/XLSX/DOCX/PPTX content. Normalized writes cannot overwrite imported or externally modified originals. Use open/apply/snapshot/save/close for a live native document session. Apply one paragraph, slide object, or cell region operation at a time with the snapshot's expected_version and a stable operation_id; preview updates before save. Classify the exact operation's risk; the desktop validates and brokers it. A draft is not saved until save succeeds.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("create"),
          Type.Literal("write"),
          Type.Literal("read"),
          Type.Literal("modify"),
          Type.Literal("delete"),
          Type.Literal("open"),
          Type.Literal("apply"),
          Type.Literal("snapshot"),
          Type.Literal("save"),
          Type.Literal("close"),
        ]),
        session_id: Type.Optional(
          Type.String({ description: "Session ID returned by open." }),
        ),
        operation_id: Type.Optional(
          Type.String({
            description:
              "Stable ID for an apply retry; never reuse it for different content.",
          }),
        ),
        expected_version: Type.Optional(Type.Integer({ minimum: 0 })),
        discard: Type.Optional(
          Type.Boolean({
            description:
              "Explicitly discard unsaved draft when closing; defaults to false.",
          }),
        ),
        change: Type.Optional(
          Type.Union([
            Type.Object({
              type: Type.Literal("replace-text"),
              paragraph: Type.Integer({ minimum: 0 }),
              start: Type.Integer({ minimum: 0 }),
              end: Type.Integer({ minimum: 0 }),
              text: Type.String(),
            }),
            Type.Object({
              type: Type.Literal("set-object-text"),
              page: Type.Integer({ minimum: 1 }),
              object: Type.Integer({ minimum: 0 }),
              text: Type.String(),
            }),
            Type.Object({
              type: Type.Literal("set-cells"),
              sheet: Type.String(),
              row: Type.Integer({ minimum: 1 }),
              column: Type.Integer({ minimum: 1 }),
              values: Type.Array(
                Type.Array(
                  Type.Union([
                    Type.String(),
                    Type.Number(),
                    Type.Boolean(),
                    Type.Null(),
                  ]),
                ),
              ),
            }),
            Type.Object({
              type: Type.Literal("set-formula"),
              sheet: Type.String(),
              row: Type.Integer({ minimum: 1 }),
              column: Type.Integer({ minimum: 1 }),
              formula: Type.String(),
            }),
          ]),
        ),
        format: Type.Optional(
          Type.Union(
            [
              Type.Literal("pdf"),
              Type.Literal("excel"),
              Type.Literal("word"),
              Type.Literal("powerpoint"),
            ],
            {
              description:
                "Document format. Inferred from the path extension when omitted.",
            },
          ),
        ),
        path: Type.String({
          description:
            "Safe workspace-relative path with .pdf, .xlsx, .docx, or .pptx extension.",
        }),
        content: Type.Optional(
          Type.Union([
            Type.Object({
              format: Type.Literal("pdf"),
              pages: Type.Array(
                Type.Object({
                  text: Type.String(),
                  width: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                  height: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                }),
              ),
            }),
            Type.Object({
              format: Type.Literal("excel"),
              sheets: Type.Array(
                Type.Object({
                  name: Type.String(),
                  rows: Type.Array(
                    Type.Array(
                      Type.Union([
                        Type.String(),
                        Type.Number(),
                        Type.Boolean(),
                        Type.Null(),
                      ]),
                    ),
                  ),
                }),
              ),
            }),
            Type.Object({
              format: Type.Literal("word"),
              paragraphs: Type.Array(
                Type.Object({
                  text: Type.String(),
                  heading: Type.Optional(
                    Type.Integer({ minimum: 1, maximum: 6 }),
                  ),
                }),
              ),
            }),
            Type.Object({
              format: Type.Literal("powerpoint"),
              slides: Type.Array(
                Type.Object({
                  title: Type.Optional(Type.String()),
                  body: Type.Array(Type.String()),
                }),
              ),
            }),
          ]),
        ),
        patch: Type.Optional(
          Type.Union([
            Type.Object({
              type: Type.Literal("replace-text"),
              find: Type.String({ minLength: 1 }),
              replacement: Type.String(),
              all: Type.Boolean(),
            }),
            Type.Object({
              type: Type.Literal("set-cell"),
              sheet: Type.String({ minLength: 1 }),
              row: Type.Integer({ minimum: 1 }),
              column: Type.Integer({ minimum: 1 }),
              value: Type.Union([
                Type.String(),
                Type.Number(),
                Type.Boolean(),
                Type.Null(),
              ]),
            }),
          ]),
        ),
        model_approval: modelApprovalParameter,
      }),
      execute: async (_toolCallId, params) => {
        if (!context.configuration.officeEnabled)
          throw new Error(
            "Install the Office suite in Plugins to use Office features.",
          );
        const hosted = context.threads.get(request.threadId);
        if (!hosted?.currentTurnId) {
          throw new Error(
            "No active turn is available for this Office document operation.",
          );
        }
        const actor = resolveActor();
        const normalizedPath = normalizedWritePaths(request.workspacePath, [
          params.path,
        ])[0]!;
        if (
          actor.actorAgentId &&
          params.operation !== "read" &&
          !writePathAllowed(actor.writePaths ?? [], normalizedPath)
        ) {
          throw new Error(
            `Sub-agent ${actor.actorAgentId} cannot modify an Office document outside its assigned scope: ${normalizedPath}.`,
          );
        }
        const document = [
          "open",
          "apply",
          "snapshot",
          "save",
          "close",
        ].includes(params.operation)
          ? artifactSessionRequestSchema.parse({
              protocolVersion: 2,
              requestId: randomUUID(),
              operation: params.operation,
              format: params.format ?? officeDocumentFormatForPath(params.path),
              path: params.path,
              ...(params.session_id === undefined
                ? {}
                : { sessionId: params.session_id }),
              ...(params.operation_id === undefined
                ? {}
                : { operationId: params.operation_id }),
              ...(params.expected_version === undefined
                ? {}
                : { expectedVersion: params.expected_version }),
              ...(params.change === undefined ? {} : { change: params.change }),
              ...(params.discard === undefined
                ? {}
                : { discard: params.discard }),
            })
          : officeDocumentRequestSchema.parse({
              protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
              requestId: randomUUID(),
              operation: params.operation,
              format: params.format ?? officeDocumentFormatForPath(params.path),
              path: params.path,
              ...(params.content === undefined
                ? {}
                : { content: params.content }),
              ...(params.patch === undefined ? {} : { patch: params.patch }),
            });
        const brokerResult = await context.broker.request({
          kind: "office.document",
          approvalId: randomUUID(),
          threadId: request.threadId,
          turnId: hosted.currentTurnId,
          workspacePath: request.workspacePath,
          document,
          ...(actor.actorAgentId ? { actorAgentId: actor.actorAgentId } : {}),
          modelApproval: modelApproval(params.model_approval),
          mode: hosted.currentMode ?? "plan",
        });
        if (!brokerResult.approved) {
          throw new Error(
            brokerResult.error ??
              "The user denied this Office document operation.",
          );
        }
        const data = brokerResult.data as OfficeDocumentResult | undefined;
        return {
          content: [
            {
              type: "text",
              text: data
                ? JSON.stringify(data, null, 2)
                : `Completed ${document.operation} for ${document.path}`,
            },
          ],
          details: data ?? {
            operation: document.operation,
            path: document.path,
          },
        };
      },
    });
  return createOfficeDocumentTool;
}
