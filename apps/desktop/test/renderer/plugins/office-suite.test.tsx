// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResourceCenter } from "../../../src/renderer/plugins/ResourceCenter.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("offers one Office installation, hides legacy basic plugins, and refreshes after install and uninstall", async () => {
  let active = false;
  const install = vi.fn(async () => {
    active = true;
  });
  const uninstall = vi.fn(async () => {
    active = false;
  });
  const basicInstall = vi.fn();
  const plugins = ["documents", "spreadsheets", "presentations", "pdf"].map(
    (name) => ({
      id: name,
      name,
      displayName: name,
      version: "1.1.0",
      description: "Legacy basic plugin",
      source: { kind: "bundled", pluginName: name },
      installed: true,
      installable: true,
      skills: [],
      skillNames: [],
      mcpServers: [],
      mcpServerIds: [],
      apps: [],
      appIds: [],
      unsupported: [],
      warnings: [],
    }),
  );
  stubWindowArtemis({
    listMcpServers: async () => [],
    listArtemisPlugins: async () => plugins,
    listInstalledSkills: async () => [],
    getArtemisPluginMarketplaces: async () => ({
      selectedView: "bundled",
      sources: [
        {
          id: "bundled",
          displayName: "Bundled",
          builtIn: true,
          removable: false,
        },
      ],
      marketplaces: [],
      errors: [],
    }),
    loadBundledPluginMarketplace: async () => ({
      name: "Bundled",
      marketplaceName: "bundled",
      plugins,
      warnings: [],
    }),
    onResourceInstallProgress: () => () => {},
    officeCapabilityStatus: async () => ({
      id: "office-core",
      phase: "idle",
      versions: active
        ? [{ version: "1.0.0", bytes: 100, active: true, inUse: false }]
        : [],
      activeVersion: active ? "1.0.0" : undefined,
      availableVersion: "1.0.0",
      downloadedBytes: 0,
      totalBytes: 0,
      dependents: [],
    }),
    installOfficeCapability: install,
    uninstallOfficeCapability: uninstall,
    installBundledPlugins: basicInstall,
  });
  render(
    <ResourceCenter
      locale="zh-CN"
      onConfirm={async () => true}
      onSettingsChange={() => {}}
    />,
  );
  const title = await screen.findByText("Office 套件");
  const card = within(title.closest(".office-pack-card") as HTMLElement);
  await waitFor(() =>
    expect(card.getByRole("button", { name: "安装" })).toBeEnabled(),
  );
  expect(screen.queryByText("Legacy basic plugin")).toBeNull();
  expect(screen.queryByText("安装所需文档插件")).toBeNull();
  fireEvent.click(card.getByRole("button", { name: "安装" }));
  await waitFor(() => expect(install).toHaveBeenCalledOnce());
  expect(await card.findByRole("button", { name: "卸载" })).toBeVisible();
  expect(card.queryByRole("button", { name: "管理 Office 套件" })).toBeNull();
  expect(card.getByText("v1.0.0")).toBeVisible();
  expect(card.getByRole("button", { name: "卸载" })).toHaveClass(
    "plugin-market-remove-action",
  );
  fireEvent.click(card.getByRole("button", { name: "卸载" }));
  await waitFor(() => expect(uninstall).toHaveBeenCalledWith("1.0.0"));
  expect(await card.findByRole("button", { name: "安装" })).toBeVisible();
  expect(card.queryByText("v1.0.0")).toBeNull();
  expect(basicInstall).not.toHaveBeenCalled();
});
