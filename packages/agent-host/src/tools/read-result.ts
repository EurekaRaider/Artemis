import { Type } from "@sinclair/typebox";

// Codemode uses structuredContent only when the tool declares an output schema.
export const readOutputSchema = Type.Union([
  Type.String(),
  Type.Object({
    type: Type.Literal("image"),
    data: Type.String(),
    mimeType: Type.String(),
    note: Type.String(),
  }),
]);

export function imageReadResult(data: string, mimeType: string, note: string) {
  const image = { type: "image" as const, data, mimeType };
  return {
    content: [{ type: "text" as const, text: note }, image],
    structuredContent: { ...image, note },
  };
}
