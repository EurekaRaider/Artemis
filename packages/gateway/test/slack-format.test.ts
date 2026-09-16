import { expect, it } from "vitest";
import {
  formatSlackMarkdown,
  splitSlackMarkdown,
} from "../src/slack-format.js";

it("renders headings, emphasis, lists and quotes using Slack syntax", () => {
  const result = formatSlackMarkdown(
    "## 最优策略\n\n**21 个**，*至少一个*，~~20 个~~\n\n- 苹果\n- 桃子\n\n> 备注",
  );
  expect(result).toContain("*最优策略*");
  expect(result).toContain("*21 个*，_至少一个_，~20 个~");
  expect(result).toContain("• 苹果\n• 桃子");
  expect(result).toContain("> 备注");
  expect(result).not.toContain("##");
  expect(result).not.toContain("**");
});
it("turns a GFM table into labelled rows without losing any cell", () => {
  const result = formatSlackMarkdown(
    "| 破坏方式 | 可行条件 | 结果 |\n|---|---|---|\n| 圆形全是西瓜 | k ≤ 8 | 失败 |\n| 没有苹果 | k ≤ 17 | **失败** |",
  );
  expect(result).toContain(
    "• *破坏方式*: 圆形全是西瓜\n• *可行条件*: k ≤ 8\n• *结果*: 失败",
  );
  expect(result).toContain("• *破坏方式*: 没有苹果");
  expect(result).toContain("• *结果*: *失败*");
  expect(result).not.toContain("|---");
});
it("preserves code, makes safe links and never activates broadcast mentions", () => {
  const result = formatSlackMarkdown(
    "`**literal**`\n\n```ts\n/new command\nx < 3 && y > 1\n```\n\n[文档](https://example.com/a?q=1&b=2) <!channel> <@U123> [bad](javascript:alert)\n",
    (text) => text.replace("/new", "new"),
  );
  expect(result).toContain("`**literal**`");
  expect(result).toContain(
    "```\n/new command\nx &lt; 3 &amp;&amp; y &gt; 1\n```",
  );
  expect(result).toContain("<https://example.com/a?q=1&amp;b=2|文档>");
  expect(result).toContain("&lt;!channel&gt;");
  expect(result).toContain("&lt;@U123&gt;");
  expect(result).not.toContain("javascript:");
});
it("splits long tables with repeated headers and fences long code independently", () => {
  const table =
    "| Name | Value |\n|---|---|\n" +
    Array.from({ length: 40 }, (_, i) => `| Row ${i} | 内容${i} |`).join("\n");
  const parts = splitSlackMarkdown(table, 160);
  expect(parts.length).toBeGreaterThan(1);
  for (const part of parts) {
    expect(Buffer.byteLength(part)).toBeLessThanOrEqual(160);
    expect(formatSlackMarkdown(part)).toContain("*Name*");
    expect(formatSlackMarkdown(part)).not.toContain("|---");
  }
  for (let i = 0; i < 40; i++) expect(parts.join("\n")).toContain(`Row ${i} |`);
  const code = splitSlackMarkdown(
    "```js\n" + "你好 **literal**\n".repeat(80) + "```",
    160,
  );
  for (const part of code) {
    expect(part.startsWith("```\n")).toBe(true);
    expect(part.endsWith("\n```\n")).toBe(true);
    expect(Buffer.byteLength(part)).toBeLessThanOrEqual(160);
  }
});
