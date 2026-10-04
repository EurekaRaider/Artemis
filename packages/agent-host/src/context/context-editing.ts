import { Type } from "@sinclair/typebox";
import type {
  ContextEditEntryDraft,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { isExecutionMode, type RunMode } from "@artemis/protocol";

/** Changes the model's context projection; original conversation entries remain intact. */
export function contextEditingExtension(
  mode: () => RunMode | undefined,
): ExtensionFactory {
  return (pi) => {
    let pending: ContextEditEntryDraft[] = [];
    pi.on("agent_start", () => {
      pending = [];
    });
    pi.registerTool({
      name: "edit_context",
      label: "Edit model context",
      exposure: "direct",
      description:
        "List earlier assistant/tool-result context entry IDs, or replace/omit obsolete content in the model context. Original conversation history is retained. User and system instructions cannot be edited. Use compact for general context compaction.",
      parameters: Type.Object({
        edits: Type.Optional(
          Type.Array(
            Type.Object({
              entryId: Type.String(),
              replacement: Type.Union([Type.String(), Type.Null()]),
            }),
            { maxItems: 50 },
          ),
        ),
      }),
      execute: async (_id, args, signal, _update, ctx) => {
        if (!isExecutionMode(mode()))
          throw new Error("Context editing requires Work or Codemode.");
        signal?.throwIfAborted();
        const entries = ctx.sessionManager
          .getBranch()
          .filter(
            (entry) =>
              entry.type === "message" &&
              (entry.message.role === "assistant" ||
                entry.message.role === "toolResult"),
          );
        if (!args.edits)
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  entries.slice(-100).map((entry) => ({
                    id: entry.id,
                    preview: JSON.stringify(entry).slice(0, 400),
                  })),
                ),
              },
            ],
            details: {},
          };
        for (const edit of args.edits)
          if (!entries.some((entry) => entry.id === edit.entryId))
            throw new Error(
              "Only earlier assistant and tool-result entries can be edited.",
            );
        pending.push(
          ...args.edits.map((edit) => ({
            type: "context_edit" as const,
            targetId: edit.entryId,
            replacement:
              edit.replacement === null
                ? null
                : {
                    content: [
                      { type: "text" as const, text: edit.replacement },
                    ],
                  },
          })),
        );
        return {
          content: [
            {
              type: "text",
              text: `Scheduled ${args.edits.length} context edits for the next model request.`,
            },
          ],
          details: {},
        };
      },
    });
    pi.on("turn_end", () => {
      const entries = pending;
      pending = [];
      return entries.length ? { entries } : undefined;
    });
  };
}
