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
    "这次是另一件事，单独开一个任务",
    "Start a new conversation for this separate task",
    "これは別のタスクなので、新しい会話を作成してください",
  ])("recognizes only explicit new-task intent: %s", async (message) => {
    const models = fixture("NEW_TASK");
    expect(
      await classifyImControlIntent(models, selection, "Current task", message),
    ).toBe("new-task");
    const [, context] = models.completeSimple.mock.calls[0]!;
    expect(context.systemPrompt).toContain("different speaker");
    expect(context.systemPrompt).toContain("topic change");
    expect(context.systemPrompt).toContain("explicitly");
    expect(context.tools).toBeUndefined();
  });
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
    ).toBe("cancel-current");
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
    "NEW_TASK because...",
    "```NEW_TASK```",
  ])("never cancels from an invalid or negative answer: %s", async (text) => {
    expect(
      await classifyImControlIntent(
        fixture(text),
        selection,
        "task",
        "cancel task",
      ),
    ).toBe("message");
  });
  it("does not use an incomplete answer or unavailable model", async () => {
    expect(
      await classifyImControlIntent(
        fixture("CANCEL_CURRENT", "length"),
        selection,
        "task",
        "stop",
      ),
    ).toBe("message");
    const models = fixture("CANCEL_CURRENT");
    expect(
      await classifyImControlIntent(models, undefined, "task", "stop"),
    ).toBe("message");
    expect(
      await classifyImControlIntent(
        models,
        selection,
        "task",
        "a".repeat(16_001),
      ),
    ).toBe("message");
    expect(models.completeSimple).not.toHaveBeenCalled();
  });
});
