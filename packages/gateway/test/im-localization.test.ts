import { APP_LOCALES } from "@artemis/protocol";
import { describe, expect, it } from "vitest";
import { IM_MESSAGES, imText } from "../src/im-localization.js";

describe("IM system message translations", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{\{(\w+)\}\}/gu)].map((match) => match[1]).sort();
  it.each(APP_LOCALES)(
    "has complete messages and matching parameters for %s",
    (locale) => {
      const messages = IM_MESSAGES[locale];
      expect(Object.keys(messages).sort()).toEqual(
        Object.keys(IM_MESSAGES.en).sort(),
      );
      for (const [key, source] of Object.entries(IM_MESSAGES.en)) {
        const value = messages[key as keyof typeof messages];
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
        expect(placeholders(value), `${locale}:${key}`).toEqual(
          placeholders(source),
        );
        if (locale !== "en") expect(value, `${locale}:${key}`).not.toBe(source);
      }
    },
  );
  it("inserts user data once without treating it as another message or parameter", () => {
    expect(
      imText("ja", "taskFailed", { message: "任务已取消。 {{id}} / original" }),
    ).toBe("タスクが失敗しました：任务已取消。 {{id}} / original");
    expect(imText("ar", "task", { id: "task-12" })).toBe(
      "المهمة \u2068task-12\u2069",
    );
  });
});
