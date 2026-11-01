import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARTEMIS_ICON_NAMES, ArtemisIcon } from "@artemis/ui/icons";
import {
  RESOURCE_ICON_NAMES,
  ResourceAvatar,
  resourceBrandName,
  resourceIconName,
} from "../../../src/renderer/plugins/resource-icons.js";

describe("Nocturne resource icons", () => {
  it("ships every resource glyph on the shared 24px grid", () => {
    expect(new Set(RESOURCE_ICON_NAMES).size).toBe(RESOURCE_ICON_NAMES.length);
    for (const name of RESOURCE_ICON_NAMES) {
      expect(ARTEMIS_ICON_NAMES).toContain(name);
      const markup = renderToStaticMarkup(createElement(ArtemisIcon, { name }));
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toContain('stroke-width="1.6"');
    }
  });
  // Geometry from ResourceIcons.dc.html: bulb, flask, bug, database and mail.
  it.each([
    [
      "brainstorming",
      "M9.5 17.5h5 M10.5 20.5h3 M12 3.5a5.8 5.8 0 0 0-3.4 10.5c.6.5.9 1.1.9 1.9v1.6h5v-1.6c0-.8.3-1.4.9-1.9A5.8 5.8 0 0 0 12 3.5z",
    ],
    [
      "test",
      "M9.5 3.5h5 M10.5 3.5v5.3l-5 8.6a2 2 0 0 0 1.7 3.1h9.6a2 2 0 0 0 1.7-3.1l-5-8.6V3.5 M7.6 14.5h8.8",
    ],
    [
      "debug",
      "M8.5 10.5a3.5 3.5 0 0 1 7 0V15a3.5 3.5 0 0 1-7 0z M12 11v7.5 M8.5 13H5 M19 13h-3.5 M5.5 8.5l3 2 M18.5 8.5l-3 2 M5.5 18.5l3-2 M18.5 18.5l-3-2 M10 7.5L8.5 5 M14 7.5L15.5 5",
    ],
    [
      "database",
      "M5.5 6.5c0-1.7 2.9-3 6.5-3s6.5 1.3 6.5 3-2.9 3-6.5 3-6.5-1.3-6.5-3z M5.5 6.5v11c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3v-11 M5.5 12c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3",
    ],
    [
      "email",
      "M4 7a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17z M4.5 7.5l7.5 5.5 7.5-5.5",
    ],
  ])("renders the design-board geometry for %s", (name, path) => {
    const markup = renderToStaticMarkup(
      <ResourceAvatar kind="skill" name={name} />,
    );
    expect(markup.match(/<(?:path|circle|ellipse|rect)\b[^>]*>/g)).toEqual([
      `<path d="${path}">`,
    ]);
  });
  it.each([
    ["idea", "构思", "lightbulb"],
    ["planning", "规划", "checklist"],
    ["goal", "目标", "target"],
    ["writing", "写作", "edit"],
    ["document", "文档", "document"],
    ["spreadsheet", "表格", "spreadsheet"],
    ["presentation", "演示", "presentation"],
    ["reference", "资料", "book"],
    ["research", "搜索", "search"],
    ["design", "设计", "palette"],
    ["refactor", "代码", "code"],
    ["test", "测试", "test"],
    ["debug", "调试", "bug"],
    ["review", "评审", "review"],
    ["git", "分支", "git-branch"],
    ["deploy", "发布", "rocket"],
    ["shell", "终端", "terminal"],
    ["browser", "网页", "browser"],
    ["desktop", "桌面", "monitor"],
    ["agent", "智能体", "agent"],
    ["analytics", "分析", "chart"],
    ["database", "数据库", "database"],
    ["email", "邮件", "email"],
    ["schedule", "日程", "calendar"],
    ["message", "消息", "chat"],
    ["security", "安全", "shield"],
    ["image", "图片", "image"],
    ["creative", "创作", "wand"],
    ["translate", "翻译", "translate"],
    ["uncatalogued", "未知", "skill"],
  ])("maps English %s and Chinese %s to %s", (en, zh, icon) => {
    expect(resourceIconName(en, "skill")).toBe(icon);
    expect(resourceIconName(zh, "skill")).toBe(icon);
    expect(
      resourceIconName("capability", "skill", {
        description: `${en} assistance. Other text.`,
      }),
    ).toBe(icon);
  });
  it("uses plugin ownership before brands and purpose, and invalidates the id cache", () => {
    expect(resourceIconName("github", "skill", { pluginName: "office" })).toBe(
      "document",
    );
    expect(
      resourceIconName("test-design", "skill", { pluginName: "spreadsheets" }),
    ).toBe("spreadsheet");
    expect(
      resourceIconName("unknown", "skill", {
        id: "same",
        description: "Search items.",
      }),
    ).toBe("search");
    expect(
      resourceIconName("unknown", "skill", {
        id: "same",
        description: "Schedule meetings.",
      }),
    ).toBe("calendar");
    expect(
      resourceIconName("unknown", "skill", {
        description: "Unknown. Search later.",
      }),
    ).toBe("skill");
  });
  it("uses exact brand names and command package tokens, not substrings", () => {
    expect(resourceBrandName("GitHub")).toBe("github");
    expect(resourceBrandName("github-helper")).toBeUndefined();
    expect(
      resourceBrandName(
        "helper",
        "npx @modelcontextprotocol/server-github@1.0.0",
      ),
    ).toBe("github");
    expect(resourceBrandName("helper", "npx github-helper")).toBeUndefined();
    expect(resourceIconName("github", "skill")).toBe("github");
    expect(resourceIconName("slack", "mcp", { transport: "http" })).toBe(
      "slack",
    );
  });
  it.each([
    ["filesystem", "folder"],
    ["postgres", "database"],
    ["sqlite", "database"],
    ["mysql", "database"],
    ["playwright", "browser"],
    ["puppeteer", "browser"],
    ["chrome-devtools", "browser"],
    ["memory", "book"],
  ])("maps MCP type %s before its remote transport", (name, icon) => {
    expect(resourceIconName(name, "mcp", { transport: "sse" })).toBe(icon);
  });
  it("falls back by MCP transport", () => {
    expect(resourceIconName("unknown", "mcp", { transport: "stdio" })).toBe(
      "mcp",
    );
    expect(resourceIconName("unknown", "mcp", { transport: "http" })).toBe(
      "server",
    );
    expect(resourceIconName("unknown", "mcp", { transport: "sse" })).toBe(
      "server",
    );
  });
  it("only plugin-owned tiles carry a hue, preserving third-party artwork", () => {
    const plain = renderToStaticMarkup(
      <ResourceAvatar kind="skill" name="document" />,
    );
    const owned = renderToStaticMarkup(
      <ResourceAvatar kind="skill" name="test" pluginName="office" />,
    );
    const image = renderToStaticMarkup(
      <ResourceAvatar
        kind="skill"
        name="test"
        iconDataUrl="data:image/png;base64,AA=="
      />,
    );
    expect(plain).not.toContain("--resource-plugin-hue");
    expect(image).not.toContain("--resource-plugin-hue");
    expect(image).toContain("<img");
    expect(owned).toContain("--resource-plugin-hue:255");
    expect(owned).toContain('data-icon="document"');
  });
  it("matches the Computer Use card's 225 hue for its owned skills", () => {
    const markup = renderToStaticMarkup(
      <ResourceAvatar
        kind="skill"
        name="desktop-action"
        pluginName="computer-use"
      />,
    );
    expect(markup).toContain("--resource-plugin-hue:225");
    expect(markup).toContain('data-icon="monitor"');
  });
});
