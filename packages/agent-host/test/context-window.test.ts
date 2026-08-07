import { describe, expect, it } from "vitest";

import {
  compactionSettingsForContextWindow,
  configureModelContextWindow,
} from "../src/context-window.js";

describe("context window configuration", () => {
  it("configures Pi auto-compaction to trigger after 90 percent", () => {
    const settings = compactionSettingsForContextWindow(258_000);

    expect(settings).toMatchObject({
      enabled: true,
      reserveTokens: 25_800,
    });
    expect(258_000 - settings.reserveTokens).toBe(232_200);
  });

  it("overrides a model window without mutating the catalog model", () => {
    const model = { id: "gpt-5.6", contextWindow: 400_000 };
    const configured = configureModelContextWindow(model, 258_000);

    expect(configured).toEqual({ id: "gpt-5.6", contextWindow: 258_000 });
    expect(model.contextWindow).toBe(400_000);
    expect(() => configureModelContextWindow(model, 500_000)).toThrow(
      "cannot exceed",
    );
  });
});
