import { describe, expect, it } from "vitest";

import {
  deriveTaskTitle,
  isAutomaticTaskTitle,
} from "../src/main/task-title.js";

describe("task titles", () => {
  it("derives a concise Chinese title from the first task request", () => {
    expect(
      deriveTaskTitle(
        "帮我修复登录页面偶发白屏的问题，并补充对应的回归测试。",
        "zh-CN",
      ),
    ).toBe("修复登录页面偶发白屏的问题");
  });

  it("derives an English title without polite request boilerplate", () => {
    expect(
      deriveTaskTitle(
        "Please add archived conversation search and restore support.\nKeep it compact.",
        "en",
      ),
    ).toBe("Add archived conversation search and restore support");
  });

  it("uses a localized attachment title when the prompt has no text", () => {
    expect(deriveTaskTitle("", "zh-CN")).toBe("分析附件");
    expect(deriveTaskTitle("", "en")).toBe("Inspect attachments");
  });

  it("uses a localized title for project initialization", () => {
    expect(deriveTaskTitle("/init", "zh-CN")).toBe("初始化项目");
    expect(deriveTaskTitle("/INIT", "en")).toBe("Initialize project");
  });

  it("hides loaded Skill commands from the automatic task title", () => {
    expect(
      deriveTaskTitle(
        "/skill:excel-live-control /skill:spreadsheets 你可以处理csv吗",
        "zh-CN",
      ),
    ).toBe("你可以处理csv吗");
  });

  it("recognizes new and legacy automatic placeholders", () => {
    expect(isAutomaticTaskTitle("等待任务内容")).toBe(true);
    expect(isAutomaticTaskTitle("Waiting for task")).toBe(true);
    expect(isAutomaticTaskTitle("新任务")).toBe(true);
    expect(isAutomaticTaskTitle("New task")).toBe(true);
    expect(isAutomaticTaskTitle("User supplied title")).toBe(false);
  });
});
