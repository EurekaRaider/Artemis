// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
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

it.each([
  ["office-core", true, false],
  ["office-core", false, false],
  ["artemis-design", true, false],
  ["artemis-design", false, false],
  ["office-core", true, true],
  ["artemis-design", true, true],
] as const)(
  "uninstalls all versions from the %s card or waits for old leases (active=%s, inUse=%s)",
  async (packId, active, inUse) => {
    vi.resetModules();
    const { ResourceCenter } =
      await import("../../../src/renderer/plugins/ResourceCenter.js");
    const oldVersion = packId === "office-core" ? "1.0.0" : "0.4.5";
    const currentVersion = packId === "office-core" ? "1.1.0" : "0.4.6";
    let versions = [
      { version: oldVersion, bytes: 10, active: false, inUse },
      { version: currentVersion, bytes: 10, active, inUse: false },
    ];
    const uninstall = vi.fn(async (version?: string) => {
      versions = version
        ? versions.filter((entry) => entry.version !== version)
        : [];
    });
    const status = (id: string) => ({
      id,
      phase: "idle",
      versions: id === packId ? versions : [],
      activeVersion:
        id === packId && active && versions.some((entry) => entry.active)
          ? currentVersion
          : undefined,
      availableVersion: currentVersion,
      downloadedBytes: 0,
      totalBytes: 0,
      dependents: [],
    });
    stubWindowArtemis({
      listMcpServers: async () => [],
      listArtemisPlugins: async () => [],
      listInstalledSkills: async () => [],
      getArtemisPluginMarketplaces: async () => ({
        selectedView: "bundled",
        sources: [],
        marketplaces: [],
        errors: [],
      }),
      loadBundledPluginMarketplace: async () => undefined,
      onResourceInstallProgress: () => () => {},
      checkOfficeCapabilityUpdates: async () => {},
      checkDesignCapabilityUpdates: async () => {},
      officeCapabilityStatus: async () => status("office-core"),
      designCapabilityStatus: async () => status("artemis-design"),
      uninstallOfficeCapability: uninstall,
      uninstallDesignCapability: uninstall,
    });
    const { container } = render(
      <ResourceCenter
        locale="en"
        onConfirm={async () => true}
        onSettingsChange={() => {}}
      />,
    );
    const selector =
      packId === "office-core" ? ".office-pack-card" : ".design-pack-card";
    await waitFor(() =>
      expect(container.querySelector(selector)?.textContent).toContain(
        `v${currentVersion}`,
      ),
    );
    const card = within(container.querySelector(selector) as HTMLElement);
    const button = card.getByRole("button", {
      name: packId === "office-core" ? "Remove" : "Uninstall",
      exact: true,
    });
    if (inUse) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(uninstall).not.toHaveBeenCalled();
      return;
    }
    fireEvent.click(button);
    await waitFor(() => expect(uninstall).toHaveBeenCalledWith());
    expect(
      await card.findByRole("button", { name: "Install", exact: true }),
    ).toBeVisible();
    expect(card.queryByText(`v${oldVersion}`)).toBeNull();
    expect(card.queryByText(`v${currentVersion}`)).toBeNull();
  },
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["0.4.4", undefined])(
  "does not use a newer marketplace version as the installed plugin version (%s)",
  async (version) => {
    vi.resetModules();
    const { ResourceCenter } =
      await import("../../../src/renderer/plugins/ResourceCenter.js");
    const plugin = {
      id: "fixture-version",
      name: "fixture-version",
      displayName: "Version fixture",
      version: "0.4.5",
      description: "Version fixture",
      source: { kind: "bundled", path: "/synthetic/plugin" },
      installed: true,
      installable: true,
      skills: [],
      mcpServers: [],
      apps: [],
      unsupported: [],
      warnings: [],
    };
    stubWindowArtemis({
      listMcpServers: async () => [],
      listArtemisPlugins: async () => [
        { ...plugin, version, skillNames: [], mcpServerIds: [] },
      ],
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
    });
    const { container } = render(
      <ResourceCenter
        locale="en"
        onConfirm={async () => false}
        onSettingsChange={() => {}}
      />,
    );
    let title!: HTMLElement;
    await waitFor(() => {
      title = Array.from(
        container.querySelectorAll(".plugin-market-card strong"),
      ).find((node) =>
        node.textContent?.startsWith("Version fixture"),
      ) as HTMLElement;
      expect(title?.title).toBe(
        version ? `Version fixture v${version}` : "Version fixture",
      );
    });
    expect(title.textContent).not.toContain("0.4.5");
  },
);

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
  expect(await screen.findByText(/设计: 发现新版本 0.3.0/)).toBeVisible();
  expect(screen.queryByText("设计插件")).toBeNull();
  expect(officeCheck).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Office: 发现新版本 1.1.0/)).toBeVisible();
  expect(install).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "更新到 0.3.0" })[0]!);
  expect(await screen.findByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getAllByRole("button", { name: "更新到 1.1.0" })[0]!);
  expect(await screen.findByRole("dialog")).toBeVisible();
  first.unmount();
  render(<ResourceCenter {...props} />);
  await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
  expect(officeCheck).toHaveBeenCalledTimes(2);
});

it.each([true, false])(
  "keeps the installed version during catalog checks and installation (active=%s)",
  async (active) => {
    let finishCheck!: () => void;
    let finishInstall!: () => void;
    const checked = new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    const installing = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    let status = {
      id: "artemis-design",
      phase: "idle" as "idle" | "downloading",
      ...(active ? { activeVersion: "0.4.4" } : {}),
      versions: [{ version: "0.4.4", bytes: 10, active, inUse: false }],
      dependents: [],
      downloadedBytes: 0,
      totalBytes: 0,
      availableVersion: "0.4.5",
      updateVersion: undefined as string | undefined,
    };
    const install = vi.fn(async () => {
      status = { ...status, phase: "downloading", totalBytes: 100 };
      await installing;
      status = {
        ...status,
        phase: "idle",
        activeVersion: "0.4.5",
        updateVersion: undefined,
        versions: [
          { version: "0.4.5", bytes: 100, active: true, inUse: false },
        ],
      };
    });
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
      checkOfficeCapabilityUpdates: async () => {},
      officeCapabilityStatus: async () => ({
        id: "office-core",
        phase: "idle",
        versions: [],
        dependents: [],
        downloadedBytes: 0,
        totalBytes: 0,
      }),
      checkDesignCapabilityUpdates: async () => {
        await checked;
        status = { ...status, updateVersion: "0.4.5" };
      },
      designCapabilityStatus: async () => status,
      installDesignCapability: install,
    });
    const { container } = render(
      <ResourceCenter
        locale="en"
        onConfirm={async () => false}
        onSettingsChange={() => {}}
      />,
    );
    await waitFor(() =>
      expect(
        container
          .querySelector(".design-pack-card .plugin-market-card-vn")
          ?.textContent?.trim(),
      ).toBe("v0.4.4"),
    );
    const card = container.querySelector(".design-pack-card")!;
    expect(card.querySelector("strong")?.title).toContain("0.4.4");
    expect(card.textContent).not.toContain("0.4.5");
    finishCheck();
    await waitFor(() => expect(card.textContent).toContain("0.4.5"));
    expect(
      card.querySelector(".plugin-market-card-vn")?.textContent?.trim(),
    ).toBe("v0.4.4");
    const update = Array.from(card.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("0.4.5"),
    )!;
    fireEvent.click(update);
    await waitFor(() => expect(install).toHaveBeenCalledOnce());
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(card.querySelector("progress")).toBeTruthy());
    expect(
      card.querySelector(".plugin-market-card-vn")?.textContent?.trim(),
    ).toBe("v0.4.4");
    finishInstall();
    await waitFor(() =>
      expect(
        card.querySelector(".plugin-market-card-vn")?.textContent?.trim(),
      ).toBe("v0.4.5"),
    );
    expect(card.querySelector("strong")?.title).toContain("0.4.5");
    expect(card.querySelector("progress")).toBeNull();
  },
);
