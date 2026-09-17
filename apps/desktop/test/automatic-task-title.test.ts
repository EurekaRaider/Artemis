import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, Thread } from "@artemis/protocol";
import {
  AutomaticTaskTitles,
  shouldGenerateTaskTitle,
  formatImTaskTitle,
} from "../src/main/task-title.js";

function fixture() {
  let thread = { id: "task", title: "临时标题", archived: false } as
    Thread | undefined;
  let resolve!: (title: string) => void;
  const generate = vi.fn(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const apply = vi.fn((title: string) => {
    thread = { ...thread!, title };
  });
  const titles = new AutomaticTaskTitles();
  const run = () => titles.generate(thread!, generate, () => thread, apply);
  return {
    titles,
    run,
    generate,
    apply,
    resolve: (title: string) => resolve(title),
    setThread: (value: Thread | undefined) => {
      thread = value;
    },
    getThread: () => thread,
  };
}

describe("automatic model task titles", () => {
  it("keeps the fallback while pending and applies the model result once", async () => {
    const f = fixture();
    const pending = f.run();
    await f.run();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.getThread()?.title).toBe("临时标题");
    f.resolve("修复登录白屏");
    await pending;
    expect(f.apply).toHaveBeenCalledWith("修复登录白屏");
  });
  it("preserves a manual rename even if it equals the temporary title", async () => {
    const f = fixture();
    const pending = f.run();
    f.titles.cancel("task");
    f.resolve("模型标题");
    await pending;
    expect(f.apply).not.toHaveBeenCalled();
  });
  it.each(["renamed", "archived", "deleted"])(
    "ignores results for a %s task",
    async (state) => {
      const f = fixture();
      const pending = f.run();
      f.setThread(
        state === "deleted"
          ? undefined
          : {
              ...f.getThread()!,
              ...(state === "archived"
                ? { archived: true }
                : { title: "用户标题" }),
            },
      );
      f.resolve("模型标题");
      await pending;
      expect(f.apply).not.toHaveBeenCalled();
    },
  );
  it.each(["", "a\nb", "a".repeat(65)])(
    "keeps the fallback for invalid output",
    async (title) => {
      const f = fixture();
      const pending = f.run();
      f.resolve(title);
      await pending;
      expect(f.apply).not.toHaveBeenCalled();
    },
  );
  it("contains model failures without failing the conversation", async () => {
    const f = fixture();
    await expect(
      f.titles.generate(
        f.getThread()!,
        async () => {
          throw new Error("offline");
        },
        f.getThread,
        f.apply,
      ),
    ).resolves.toBeUndefined();
    expect(f.apply).not.toHaveBeenCalled();
  });
});

describe("first-message title eligibility", () => {
  it("only names untouched conversations on a user turn", () => {
    expect(shouldGenerateTaskTitle("New task", "user", [])).toBe(true);
    expect(shouldGenerateTaskTitle("My title", "user", [])).toBe(false);
    expect(shouldGenerateTaskTitle("New task", "goal-continuation", [])).toBe(
      false,
    );
  });
  it("does not retry on later messages or after restoring persisted history", () => {
    const events = [
      { payload: { type: "user.message", text: "first request" } },
    ] as AgentEvent[];
    expect(shouldGenerateTaskTitle("New task", "user", events)).toBe(false);
    expect(shouldGenerateTaskTitle("已生成标题", "user", events)).toBe(false);
  });
});

describe("IM task titles", () => {
  it.each([
    ["slack", "Slack"],
    ["feishu", "飞书"],
    ["wecom", "企业微信"],
  ] as const)("keeps the %s platform before the summary", (channel, label) => {
    expect(formatImTaskTitle(channel, "修复登录白屏")).toBe(
      `${label} · 修复登录白屏`,
    );
    expect(
      Array.from(formatImTaskTitle(channel, "a".repeat(64))).length,
    ).toBeLessThanOrEqual(64);
  });
  it("allows only the explicitly supplied initial IM title on the first turn", () => {
    const initial = "Slack · Jupiter 你好";
    expect(shouldGenerateTaskTitle(initial, "user", [], initial)).toBe(true);
    expect(shouldGenerateTaskTitle(initial, "user", [])).toBe(false);
    expect(shouldGenerateTaskTitle("手动命名", "user", [], initial)).toBe(
      false,
    );
    expect(
      shouldGenerateTaskTitle(initial, "goal-continuation", [], initial),
    ).toBe(false);
    expect(
      shouldGenerateTaskTitle(
        initial,
        "user",
        [{ payload: { type: "user.message", text: "你好" } }] as AgentEvent[],
        initial,
      ),
    ).toBe(false);
  });
});
