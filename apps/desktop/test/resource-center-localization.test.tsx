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
