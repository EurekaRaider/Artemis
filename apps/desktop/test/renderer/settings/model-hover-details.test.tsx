import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@artemis/protocol";
import { ModelHoverDetails } from "../../../src/renderer/settings/ModelHoverDetails.js";

function sample(index: number, reported = true): AgentEvent {
  return {
    protocolVersion: 4,
    eventId: `usage-${index}`,
    threadId: "task",
    turnId: `turn-${index}`,
    seq: index,
    timestamp: "2026-11-02T00:00:00.000Z",
    payload: {
      type: "assistant.usage",
      providerId: "local",
      modelId: "fixture",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      totalTokens: 220,
      ...(reported ? { cacheReadReported: true } : {}),
    },
  };
}
const props = {
  locale: "en" as const,
  model: "Fixture model",
  provider: "Fixture provider",
  context: undefined,
  contextWindow: 200000,
  thinking: undefined,
};

describe("model hover details", () => {
  it("keeps absent context and usage unknown and omits unsupported thinking", () => {
    const html = renderToStaticMarkup(
      <ModelHoverDetails {...props} events={[]} />,
    );
    expect(html.match(/—/gu)).toHaveLength(2);
    expect(html).not.toContain("0%");
    expect(html).not.toContain("Thinking");
  });
  it("sums reported usage across the entire task", () => {
    const html = renderToStaticMarkup(
      <ModelHoverDetails {...props} events={[sample(1), sample(2)]} />,
    );
    expect(html).toContain("440");
    expect(html).toContain("50%");
  });
  it("omits the aggregate cache percentage when one sample is unreported", () => {
    const html = renderToStaticMarkup(
      <ModelHoverDetails {...props} events={[sample(1), sample(2, false)]} />,
    );
    expect(html).toContain("440");
    expect(html).not.toContain("%");
  });
  it("labels estimated context as an estimate", () => {
    const html = renderToStaticMarkup(
      <ModelHoverDetails
        {...props}
        events={[]}
        context={{
          tokens: 76000,
          contextWindow: 200000,
          compacting: false,
          estimated: true,
          source: "local-estimate",
        }}
      />,
    );
    expect(html.toLowerCase()).toContain("estimat");
    expect(html).toContain("76K");
  });
});
