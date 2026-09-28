// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResourceCenter } from "../src/renderer/ResourceCenter.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

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
afterEach(() => vi.unstubAllGlobals());

it("recognizes an installed Office pack with legacy plugin metadata and keeps all entry labels in sync", async () => {
  const plugins = ["documents", "spreadsheets", "presentations"].map((id) => ({
    id,
    name: id,
    displayName: id,
    version: "1.0.0",
    description: "Office plugin",
    source: { kind: "local", path: `/synthetic/${id}` },
    installed: true,
    enabled: true,
    installable: true,
    skills: [],
    mcpServers: [],
    apps: [],
    unsupported: [],
    warnings: [],
    skillNames: [],
    mcpServerIds: [],
    appIds: [],
    hasHooks: false,
    capabilityDependencies: [
      { id: "office-core", version: "1.0.0", optional: true },
    ],
  }));
  let installed = true;
  const status = vi.fn(async () => ({
    id: "office-core",
    phase: "idle",
    downloadedBytes: 0,
    totalBytes: 0,
    activeVersion: installed ? "1.0.0" : undefined,
    versions: installed
      ? [{ version: "1.0.0", bytes: 10, active: true, inUse: false }]
      : [],
    dependents: installed ? plugins.map((p) => p.id) : [],
  }));
  stubWindowArtemis({
    listMcpServers: async () => [],
    listCodexPlugins: async () =>
      plugins.map(
        ({ capabilityDependencies: _dependencies, ...plugin }) => plugin,
      ),
    listInstalledSkills: async () => [],
    getCodexPluginMarketplaces: async () => ({
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
    loadCodexRuntimeMarketplace: async () => ({
      name: "Bundled",
      marketplaceName: "bundled",
      plugins,
      warnings: [],
    }),
    onResourceInstallProgress: () => () => {},
    officeCapabilityStatus: status,
    importOfficeCapability: async () => {
      installed = true;
    },
    uninstallOfficeCapability: async () => {
      installed = false;
    },
  });
  const mounted = render(
    <ResourceCenter
      locale="zh-CN"
      onConfirm={async () => false}
      onSettingsChange={() => {}}
    />,
  );
  await waitFor(() => expect(status).toHaveBeenCalled());
  const manage = await screen.findAllByRole("button", {
    name: "管理 Office 配置",
    exact: true,
  });
  expect(manage).toHaveLength(3);
  fireEvent.click(manage[0]!);
  const panel = await screen.findByRole("dialog", { name: "管理 Office 配置" });
  fireEvent.click(
    await within(panel).findByRole("button", { name: "卸载", exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: "升级 Office 功能" }),
    ).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭", exact: true }));
  expect(
    await screen.findAllByRole("button", {
      name: "升级 Office 功能",
      exact: true,
    }),
  ).toHaveLength(3);
  fireEvent.click(
    screen.getAllByRole("button", {
      name: "升级 Office 功能",
      exact: true,
    })[0]!,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "导入离线包", exact: true }),
  );
  expect(
    await screen.findByRole("dialog", { name: "管理 Office 配置" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭", exact: true }));
  expect(
    await screen.findAllByRole("button", {
      name: "管理 Office 配置",
      exact: true,
    }),
  ).toHaveLength(3);
  mounted.unmount();
  status.mockClear();
  render(
    <ResourceCenter
      locale="zh-CN"
      onConfirm={async () => false}
      onSettingsChange={() => {}}
    />,
  );
  await waitFor(() => expect(status).toHaveBeenCalled());
  expect(
    await screen.findAllByRole("button", {
      name: "管理 Office 配置",
      exact: true,
    }),
  ).toHaveLength(3);
});
