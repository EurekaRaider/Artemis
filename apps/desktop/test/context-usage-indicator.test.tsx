import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContextUsageIndicator } from "../src/renderer/ContextUsageIndicator.js";

describe("ContextUsageIndicator", () => {
  it("renders the ring and Codex-style hover details", () => {
    const html = renderToStaticMarkup(
      <ContextUsageIndicator
        contextWindow={258_000}
        locale="zh-CN"
        usage={{
          tokens: 61_000,
          contextWindow: 258_000,
          compacting: false,
        }}
      />,
    );

    expect(html).toContain('class="context-usage-ring"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("24% 已用（剩余 76%）");
    expect(html).toContain("已用 61k token，共 258k");
  });

  it("announces active automatic compaction", () => {
    const html = renderToStaticMarkup(
      <ContextUsageIndicator
        contextWindow={128_000}
        locale="en"
        usage={{
          tokens: 116_000,
          contextWindow: 128_000,
          compacting: true,
        }}
      />,
    );

    expect(html).toContain("Compacting context…");
  });

  it("shows the post-compaction estimate instead of reporting zero usage", () => {
    const html = renderToStaticMarkup(
      <ContextUsageIndicator
        contextWindow={128_000}
        locale="zh-CN"
        usage={{
          tokens: 32_000,
          contextWindow: 128_000,
          compacting: false,
          estimated: true,
        }}
      />,
    );

    expect(html).toContain("约 25% 已用（约剩余 75%）");
    expect(html).toContain("压缩后估算约 32k token，共 128k");
    expect(html).not.toContain("0% 已用");
  });

  it("labels unknown usage without drawing it as zero percent", () => {
    const html = renderToStaticMarkup(
      <ContextUsageIndicator
        contextWindow={128_000}
        locale="zh-CN"
        usage={{
          tokens: null,
          contextWindow: 128_000,
          compacting: false,
        }}
      />,
    );

    expect(html).toContain("上下文用量暂不可用");
    expect(html).not.toContain("0% 已用");
    expect(html).not.toContain('class="context-usage-progress"');
  });
});
