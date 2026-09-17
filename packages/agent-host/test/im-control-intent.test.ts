import type { AssistantMessage, Models } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it, vi } from "vitest";
import { classifyImControlIntent } from "../src/im-control-intent.js";

const model = getBuiltinModels("openai")[0]!;
const selection = {
  providerId: model.provider,
  modelId: model.id,
  thinkingLevel: "off" as const,
};
function fixture(text: string, stopReason = "stop") {
  return {
    getModel: vi.fn().mockReturnValue(model),
    completeSimple: vi.fn<Models["completeSimple"]>().mockResolvedValue({
      content: [
        { type: "thinking", thinking: "CANCEL_CURRENT" },
        { type: "text", text },
      ],
      stopReason,
    } as AssistantMessage),
  };
}

describe("semantic IM control classification", () => {
  it.each([
    "不用再忙这件事了",
    "Drop what you're doing",
    "今の作業はもうやめてください",
    "Laisse tomber",
    "لا داعي لمواصلة العمل الحالي",
    "अब इस काम को आगे मत करो",
  ])("sends the original message to a tool-free model: %s", async (message) => {
    const models = fixture("CANCEL_CURRENT");
    expect(
      await classifyImControlIntent(models, selection, "Current task", message),
    ).toBe(true);
    const [, context, options] = models.completeSimple.mock.calls[0]!;
    expect(JSON.parse(String(context.messages[0]!.content))).toEqual({
      taskTitle: "Current task",
      message,
    });
    expect(context.tools).toBeUndefined();
    expect(context.systemPrompt).toContain("ANY language");
    expect(context.systemPrompt).toContain("negation");
    expect(context.systemPrompt).toContain("untrusted data");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    "MESSAGE",
    "",
    "CANCEL_CURRENT because...",
    '{"intent":"CANCEL_CURRENT"}',
    "```CANCEL_CURRENT```",
  ])("never cancels from an invalid or negative answer: %s", async (text) => {
    expect(
      await classifyImControlIntent(
        fixture(text),
        selection,
        "task",
        "cancel task",
      ),
    ).toBe(false);
  });
  it("does not use an incomplete answer or unavailable model", async () => {
    expect(
      await classifyImControlIntent(
        fixture("CANCEL_CURRENT", "length"),
        selection,
        "task",
        "stop",
      ),
    ).toBe(false);
    const models = fixture("CANCEL_CURRENT");
    expect(
      await classifyImControlIntent(models, undefined, "task", "stop"),
    ).toBe(false);
    expect(
      await classifyImControlIntent(
        models,
        selection,
        "task",
        "a".repeat(16_001),
      ),
    ).toBe(false);
    expect(models.completeSimple).not.toHaveBeenCalled();
  });
});
