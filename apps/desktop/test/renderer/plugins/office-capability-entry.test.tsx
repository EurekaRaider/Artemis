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
  let updateVersion: string | undefined = "1.1.0";
  let finishUpdate: (() => void) | undefined;
  const install = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishUpdate = () => {
          updateVersion = undefined;
          resolve();
        };
      }),
  );
  const status = vi.fn(async () => ({
    id: "office-core",
    updateVersion,
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
    listArtemisPlugins: async () =>
      plugins.map(
        ({ capabilityDependencies: _dependencies, ...plugin }) => plugin,
      ),
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
    officeCapabilityStatus: status,
    installOfficeCapability: install,
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
  const cardActions = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-office="true"]'));
  await waitFor(() => expect(cardActions()).toHaveLength(3));
  for (const card of cardActions()) {
    expect(
      within(card).getByRole("button", { name: "更新到 1.1.0" }),
    ).toBeVisible();
  }
  install.mockRejectedValueOnce(new Error("Download failed"));
  fireEvent.click(
    within(cardActions()[0]!).getByRole("button", { name: "更新到 1.1.0" }),
  );
  expect(await screen.findByText("Download failed")).toBeVisible();
  await waitFor(() =>
    expect(
      within(cardActions()[0]!).getByRole("button", { name: "更新到 1.1.0" }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    within(cardActions()[0]!).getByRole("button", { name: "更新到 1.1.0" }),
  );
  expect(install).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).toBeNull();
  for (const card of cardActions()) {
    expect(within(card).getByRole("progressbar")).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "正在安装…" }),
    ).toBeDisabled();
  }
  finishUpdate!();
  await waitFor(() => {
    for (const card of cardActions()) {
      expect(
        within(card).queryByRole("button", { name: "更新到 1.1.0" }),
      ).toBeNull();
      expect(within(card).queryByRole("progressbar")).toBeNull();
    }
  });
  const manage = await screen.findAllByRole("button", {
    name: "管理 Office 套件",
    exact: true,
  });
  expect(manage).toHaveLength(3);
  fireEvent.click(manage[0]!);
  const panel = await screen.findByRole("dialog", { name: "管理 Office 套件" });
  fireEvent.click(
    await within(panel).findByRole("button", { name: "卸载", exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: "安装 Office 套件" }),
    ).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭", exact: true }));
  expect(
    await screen.findAllByRole("button", {
      name: "安装 Office 套件",
      exact: true,
    }),
  ).toHaveLength(3);
  fireEvent.click(
    screen.getAllByRole("button", {
      name: "安装 Office 套件",
      exact: true,
    })[0]!,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "导入离线包", exact: true }),
  );
  expect(
    await screen.findByRole("dialog", { name: "管理 Office 套件" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭", exact: true }));
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "管理 Office 套件", exact: true }),
    ).toHaveLength(3),
  );
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
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "管理 Office 套件", exact: true }),
    ).toHaveLength(3),
  );
});
