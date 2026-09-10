import { APP_LOCALES } from "@artemis/protocol";
import { describe, expect, it } from "vitest";

import { localizedTurnFailure } from "../src/renderer/turn-failure.js";
import { localizedCopy } from "../src/shared/i18n-resources.js";

const original =
  "The previous Artemis process stopped before this turn completed.";
const fallback = {
  hostRestart: original,
  modelStreamStalled: "Model stalled",
  streamInterrupted: "Stream interrupted",
  agentHostInterrupted: "Agent host interrupted",
};

describe("turn failure localization", () => {
  it.each(APP_LOCALES)(
    "localizes persisted HOST_RESTART errors in %s",
    (locale) => {
      const copy = localizedCopy(locale, "app", fallback);
      const message = localizedTurnFailure(copy, original, "HOST_RESTART");
      expect(message).toBe(copy.hostRestart);
      expect(message).toContain("Artemis");
      if (locale !== "en") expect(message).not.toBe(original);
      if (locale === "zh-CN") {
        expect(message).toBe("上次 Artemis 进程在本轮任务完成前已停止。");
      }
    },
  );

  it("translates by code and preserves unknown error details", () => {
    const copy = localizedCopy("zh-CN", "app", fallback);
    expect(
      localizedTurnFailure(copy, "Different diagnostic", "HOST_RESTART"),
    ).toBe(copy.hostRestart);
    expect(localizedTurnFailure(copy, "Provider detail", "UNKNOWN")).toBe(
      "Provider detail",
    );
    expect(localizedTurnFailure(copy, "Uncoded detail")).toBe("Uncoded detail");
  });

  it.each([
    ["MODEL_STREAM_STALLED", "modelStreamStalled"],
    ["STREAM_INTERRUPTED", "streamInterrupted"],
    ["AGENT_HOST_INTERRUPTED", "agentHostInterrupted"],
  ] as const)("preserves the %s translation", (code, key) => {
    expect(localizedTurnFailure(fallback, "Diagnostic", code)).toBe(
      fallback[key],
    );
  });
});
