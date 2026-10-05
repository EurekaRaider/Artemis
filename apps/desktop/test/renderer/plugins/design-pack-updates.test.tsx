// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
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
it("checks on every store opening and offers the Design update without installing it", async () => {
  let checked = false;
  const check = vi.fn(async () => {
    checked = true;
  });
  const install = vi.fn(async () => {});
  const officeCheck = vi.fn(async () => {});
  stubWindowArtemis({
    listMcpServers: async () => [],
    listArtemisPlugins: async () => [],
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
      plugins: [],
      warnings: [],
    }),
    onResourceInstallProgress: () => () => {},
    checkOfficeCapabilityUpdates: officeCheck,
    officeCapabilityStatus: async () => ({
      id: "office-core",
      phase: "idle",
      activeVersion: "1.0.0",
      versions: [],
      dependents: [],
      downloadedBytes: 0,
      totalBytes: 0,
      updateVersion: "1.1.0",
    }),
    checkDesignCapabilityUpdates: check,
    installDesignCapability: install,
    designCapabilityStatus: async () => ({
      id: "artemis-design",
      phase: "idle",
      activeVersion: "0.2.0",
      versions: [{ version: "0.2.0", bytes: 10, active: true, inUse: false }],
      dependents: [],
      downloadedBytes: 0,
      totalBytes: 0,
      ...(checked ? { updateVersion: "0.3.0" } : {}),
    }),
  });
  const props = {
    locale: "zh-CN" as const,
    onConfirm: async () => false,
    onSettingsChange: () => {},
  };
  const first = render(<ResourceCenter {...props} />);
  await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/设计：有新版本 0.3.0/)).toBeVisible();
  expect(screen.queryByText("设计插件")).toBeNull();
  expect(officeCheck).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Office: 发现新版本 1.1.0/)).toBeVisible();
  expect(install).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "更新到 0.3.0" })[0]!);
  expect(await screen.findByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "更新到 1.1.0" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
  first.unmount();
  render(<ResourceCenter {...props} />);
  await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
  expect(officeCheck).toHaveBeenCalledTimes(2);
});
