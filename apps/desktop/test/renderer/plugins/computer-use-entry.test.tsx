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
import type { ComputerUseRuntimeStatus } from "@artemis/protocol";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

beforeEach(() => {
  vi.resetModules();
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
const computerCards = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".plugin-market-card"),
  ).filter((card) =>
    card.querySelector("strong")?.textContent?.startsWith("Computer Use"),
  );
async function fixture(
  initial: Partial<ComputerUseRuntimeStatus>,
  installed = true,
) {
  const plugin = {
    id: "builtin-computer-use",
    name: "computer-use",
    displayName: "Computer Use",
    version: "1.2.0",
    description: "Desktop automation",
    source: { kind: "builtin", pluginName: "computer-use" },
    installed,
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
  };
  let current = {
    id: "computer-use",
    phase: "idle",
    versions: [],
    downloadedBytes: 0,
    totalBytes: 0,
    dependents: [],
    supported: true,
    ...initial,
  };
  const status = vi.fn(async () => current);
  const update = vi.fn(async () => {
    throw new Error("retry attempted");
  });
  const cancel = vi.fn(async () => {});
  stubWindowArtemis({
    listMcpServers: async () => [],
    listArtemisPlugins: async () => (installed ? [plugin] : []),
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
      plugins: [plugin],
      warnings: [],
    }),
    onResourceInstallProgress: () => () => {},
    computerRuntimeStatus: status,
    checkComputerRuntimeUpdates: async () => {},
    cancelComputerRuntimeDownload: cancel,
    updateArtemisPlugin: update,
  });
  const { ResourceCenter } =
    await import("../../../src/renderer/plugins/ResourceCenter.js");
  render(
    <ResourceCenter
      locale="zh-CN"
      onConfirm={async () => true}
      onSettingsChange={() => {}}
    />,
  );
  await waitFor(() => expect(status).toHaveBeenCalled());
  await waitFor(() => expect(computerCards()).toHaveLength(1));
  return {
    card: within(computerCards()[0]!),
    status,
    update,
    cancel,
    next: (value: Partial<ComputerUseRuntimeStatus>) => {
      current = { ...current, ...value };
    },
  };
}
it("shows a single card and keeps the old version visible while an update waits", async () => {
  const f = await fixture({ activeVersion: "1.2.0", pendingVersion: "1.2.1" });
  const waiting = await screen.findByRole("button", {
    name: "v1.2.1 已就绪，等待任务结束后切换",
  });
  expect(waiting).toBeDisabled();
  expect(computerCards()).toHaveLength(1);
  expect(screen.getByText("v1.2.0")).toBeVisible();
  f.next({ error: "configuration commit failed" });
  expect(await screen.findByText("configuration commit failed")).toBeVisible();
  fireEvent.click(
    await screen.findByRole("button", { name: "重试", exact: true }),
  );
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(1));
});
it("offers migration for an installed legacy plugin without a native runtime", async () => {
  const f = await fixture({ migrationRequired: true });
  expect(
    await screen.findByText("下载运行时后可继续使用 Computer Use"),
  ).toBeVisible();
  expect(
    f.card.getByRole("button", { name: "安装", exact: true }),
  ).toBeEnabled();
  expect(screen.queryByText("v1.2.0")).toBeNull();
});
it("shows download progress and lets the user cancel", async () => {
  const f = await fixture({
    activeVersion: "1.2.0",
    phase: "downloading",
    downloadedBytes: 25,
    totalBytes: 100,
  });
  const progress = await screen.findByRole("progressbar");
  expect(progress).toHaveAttribute("value", "25");
  expect(progress).toHaveAttribute("max", "100");
  fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
  expect(f.cancel).toHaveBeenCalledTimes(1);
});
it("disables installation when the host reports an unsupported platform", async () => {
  const f = await fixture({ supported: false }, false);
  expect(
    await screen.findByText("需要 macOS 14+ arm64 或 Windows 11 x64"),
  ).toBeVisible();
  expect(
    f.card.getByRole("button", { name: "安装", exact: true }),
  ).toBeDisabled();
  expect(computerCards()).toHaveLength(1);
});
