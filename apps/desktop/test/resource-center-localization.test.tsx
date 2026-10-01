// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ResourceCenter } from "../src/renderer/ResourceCenter.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const plugin = {
  id: "qq-plugin",
  name: "qq-mail",
  displayName: "QQ Mail",
  version: "0.2.0",
  description: "Mail plugin",
  source: { kind: "local", path: "/synthetic/qq" },
  installed: false,
  installable: true,
  skills: [],
  mcpServers: [],
  apps: [],
  unsupported: [],
  warnings: [],
};
const market = {
  selectedView: "shop",
  sources: [
    {
      id: "shop",
      displayName: "ArtemisPluginShop",
      marketplaceName: "artemis-plugin-shop",
      repository: "synthetic/shop",
      builtIn: false,
      removable: true,
    },
  ],
  marketplaces: [
    {
      sourceId: "shop",
      marketplace: {
        name: "ArtemisPluginShop",
        marketplaceName: "artemis-plugin-shop",
        plugins: [plugin],
        warnings: [],
      },
    },
  ],
  errors: [],
};
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

it("updates marketplace names and searches localized descriptions after a language change", async () => {
  const user = userEvent.setup();
  const localized = {
    ...plugin,
    category: "Communication",
    localizations: {
      "zh-CN": {
        displayName: "示例邮箱",
        description: "收发邮件和管理收件箱",
      },
      ja: {
        displayName: "サンプルメール",
        description: "メールの送受信と受信トレイの管理",
      },
    },
  };
  const loadMarket = vi.fn(async () => ({
    ...market,
    marketplaces: [
      {
        ...market.marketplaces[0],
        marketplace: {
          ...market.marketplaces[0]!.marketplace,
          plugins: [localized],
        },
      },
    ],
  }));
  stubWindowArtemis({
    listMcpServers: async () => [],
    listCodexPlugins: async () => [],
    listInstalledSkills: async () => [],
    getCodexPluginMarketplaces: loadMarket,
    loadCodexRuntimeMarketplace: async () => undefined,
    onResourceInstallProgress: () => () => {},
  });
  const props = {
    onConfirm: async () => false,
    onSettingsChange: () => {},
  };
  const view = render(<ResourceCenter {...props} locale="zh-CN" />);
  expect(await screen.findByText("示例邮箱")).toBeVisible();
  const search = screen.getByRole("searchbox");
  await user.type(search, "收件箱");
  expect(screen.getByText("示例邮箱")).toBeVisible();
  await user.clear(search);
  await user.type(search, "no-matching-plugin");
  expect(screen.queryByText("示例邮箱")).toBeNull();
  await user.clear(search);
  view.rerender(<ResourceCenter {...props} locale="ja" />);
  expect(screen.getByText("サンプルメール")).toBeVisible();
  expect(screen.getByText("メールの送受信と受信トレイの管理")).toBeVisible();
  await user.type(search, "受信トレイ");
  expect(screen.getByText("サンプルメール")).toBeVisible();
  expect(loadMarket).toHaveBeenCalledOnce();
});

it("switches bundled Office descriptions only when the capability is active and keeps PDF copy unchanged", async () => {
  const { fireEvent } = await import("@testing-library/react");
  vi.resetModules();
  const { ResourceCenter } = await import("../src/renderer/ResourceCenter.js");
  let activeVersion: string | undefined;
  const plugins = ["documents", "presentations", "spreadsheets", "pdf"].map(
    (name) => ({
      ...plugin,
      id: name,
      name,
      displayName: name,
      source: { kind: "bundled" as const, pluginName: name },
      capabilityDependencies:
        name === "pdf" ? [] : [{ id: "office-core", optional: true }],
      localizations: { "zh-CN": { description: "旧的基础功能说明" } },
    }),
  );
  stubWindowArtemis({
    listMcpServers: async () => [],
    listCodexPlugins: async () => [],
    listInstalledSkills: async () => [],
    getCodexPluginMarketplaces: async () => ({
      ...market,
      marketplaces: [
        {
          ...market.marketplaces[0],
          marketplace: { ...market.marketplaces[0]!.marketplace, plugins },
        },
      ],
    }),
    loadCodexRuntimeMarketplace: async () => ({
      name: "runtime",
      marketplaceName: "runtime",
      plugins,
      warnings: [],
    }),
    officeCapabilityStatus: async () => ({
      id: "office-core",
      activeVersion,
      versions: [
        {
          version: "1.0.0",
          bytes: 100,
          active: Boolean(activeVersion),
          inUse: false,
        },
      ],
      dependents: [],
      phase: "idle",
      downloadedBytes: 0,
      totalBytes: 0,
    }),
    onResourceInstallProgress: () => () => {},
  });
  render(
    <ResourceCenter
      locale="zh-CN"
      onConfirm={async () => false}
      onSettingsChange={() => {}}
    />,
  );
  for (const format of ["Word", "PowerPoint", "Excel"]) {
    expect(
      await screen.findByText(`提供基础的 ${format} 文档读写。`),
    ).toBeVisible();
  }
  const pdfDescription = "读取 PDF 文本内容，创建文本 PDF 文档。";
  expect(screen.getByText(pdfDescription)).toBeVisible();
  activeVersion = "1.0.0";
  fireEvent.focus(window);
  for (const format of ["Word", "PowerPoint", "Excel"]) {
    expect(
      await screen.findByText(`提供高级的 ${format} 文档读写与编辑功能。`),
    ).toBeVisible();
  }
  expect(screen.getByText(pdfDescription)).toBeVisible();
  activeVersion = undefined;
  fireEvent.focus(window);
  expect(await screen.findByText("提供基础的 Word 文档读写。")).toBeVisible();
});
