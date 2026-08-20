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
    expect(html).toContain("已用 6.1万 Token，共 25.8万");
  });

  it("advances the ring for sub-percent growth in large contexts", () => {
    const html = renderToStaticMarkup(
      <ContextUsageIndicator
        contextWindow={1_000_000}
        locale="en"
        usage={{
          tokens: 1_000,
          contextWindow: 1_000_000,
          compacting: false,
        }}
      />,
    );

    expect(html).toContain("stroke-dashoffset:99.9");
    expect(html).toContain("0% used (100% left)");
  });

  it("lists the estimated current context by source category", () => {
    const html = renderToStaticMarkup(
      <ContextUsageIndicator
        contextWindow={1_048_576}
        locale="zh-CN"
        usage={{
          tokens: 11_623,
          contextWindow: 1_048_576,
          compacting: false,
          source: "provider",
          breakdown: {
            systemPromptTokens: 2_000,
            systemToolTokens: 3_000,
            mcpToolTokens: 2_000,
            customAgentTokens: 0,
            memoryFileTokens: 1_000,
            skillTokens: 1_000,
            messageTokens: 2_623,
            freeSpaceTokens: 932_096,
            autocompactBufferTokens: 104_857,
          },
        }}
      />,
    );

    expect(html).toContain("按类别估算的用量");
    expect(html).toContain("系统提示词</dt><dd>2000 Token (0.2%)");
    expect(html).toContain("系统工具</dt><dd>3000 Token (0.3%)");
    expect(html).toContain("MCP 工具</dt><dd>2000 Token (0.2%)");
    expect(html).toContain("记忆文件</dt><dd>1000 Token (0.1%)");
    expect(html).toContain("Skills</dt><dd>1000 Token (0.1%)");
    expect(html).toContain("消息</dt><dd>2623 Token (0.3%)");
    expect(html).toContain("可用空间</dt><dd>93.2万 Token (88.9%)");
    expect(html).toContain("自动压缩缓冲区</dt><dd>10.5万 Token (10%)");
    expect(html).not.toContain("自定义代理</dt>");
  });

  it("matches the Claude Code category names and order in English", () => {
    const html = renderToStaticMarkup(
      <ContextUsageIndicator
        contextWindow={200_000}
        locale="en"
        usage={{
          tokens: 10_000,
          contextWindow: 200_000,
          compacting: false,
          source: "provider",
          breakdown: {
            systemPromptTokens: 2_000,
            systemToolTokens: 3_000,
            mcpToolTokens: 1_000,
            customAgentTokens: 500,
            memoryFileTokens: 500,
            skillTokens: 500,
            messageTokens: 2_500,
            freeSpaceTokens: 170_000,
            autocompactBufferTokens: 20_000,
          },
        }}
      />,
    );

    expect(html).toContain("Estimated usage by category");
    const categories = [
      "System prompt",
      "System tools",
      "MCP tools",
      "Custom agents",
      "Memory files",
      "Skills",
      "Messages",
      "Free space",
      "Autocompact buffer",
    ];
    const positions = categories.map((category) =>
      html.indexOf(`${category}</dt>`),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(
      [...positions].sort((left, right) => left - right),
    );
    expect(html).toContain("System tools</dt><dd>3K Token (1.5%)");
    expect(html).toContain("Autocompact buffer</dt><dd>20K Token (10%)");
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
    expect(html).toContain("压缩后估算约 3.2万 Token，共 12.8万");
    expect(html).not.toContain("0% 已用");
  });

  it("distinguishes the current estimate from the last provider measurement", () => {
    const html = renderToStaticMarkup(
      <ContextUsageIndicator
        contextWindow={1_048_576}
        locale="zh-CN"
        usage={{
          tokens: 571_764,
          contextWindow: 1_048_576,
          compacting: false,
          estimated: true,
          source: "local-estimate",
          providerInputTokens: 84_766,
        }}
      />,
    );

    expect(html).toContain("约 55% 已用");
    expect(html).toContain("当前估算约 57.2万 Token，共 104.9万");
    expect(html).toContain("上次模型实测输入 8.5万 Token");
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
