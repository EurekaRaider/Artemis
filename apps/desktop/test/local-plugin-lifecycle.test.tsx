// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ArtemisPluginPreview,
  InstalledArtemisPlugin,
} from "../src/shared/api.js";
import { UI_COPY } from "../src/shared/ui-copy.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const t = UI_COPY.ResourceCenter_labels.en;
const preview: ArtemisPluginPreview = {
  id: "ocean-skins",
  name: "ocean-skins",
  displayName: "Ocean Skins",
  version: "1.0.0",
  description: "Synthetic local plugin",
  source: { kind: "local", path: "/synthetic/ocean-skins" },
  iconDataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  installed: false,
  installable: true,
  skills: [],
  mcpServers: [],
  apps: [],
  unsupported: [],
  warnings: [],
};
const installed: InstalledArtemisPlugin = {
  ...preview,
  installed: true,
  skillNames: [],
  mcpServerIds: [],
  contentHash: "synthetic",
  installedAt: "2026-10-02",
  updatedAt: "2026-10-02",
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

async function setup(
  initial: InstalledArtemisPlugin[] = [],
  overrides: Record<string, unknown> = {},
) {
  const user = userEvent.setup();
  const state = {
    sources: [],
    marketplaces: [],
    errors: [],
    selectedView: "local",
  };
  const settings = { mcpServers: [], trustedExtensions: [] };
  const inspect = vi.fn(
    async (): Promise<ArtemisPluginPreview | undefined> => preview,
  );
  const install = vi.fn(async () => ({
    plugins: [installed],
    skills: [],
    warnings: [],
    settings,
  }));
  const remove = vi.fn(async () => ({
    plugins: [],
    skills: [],
    warnings: [],
    settings,
  }));
  stubWindowArtemis({
    listArtemisPlugins: async () => initial,
    listInstalledSkills: async () => [],
    listMcpServers: async () => [],
    getArtemisPluginMarketplaces: async () => state,
    selectArtemisPluginMarketplace: async () => state,
    loadBundledPluginMarketplace: async () => undefined,
    onResourceInstallProgress: () => () => {},
    inspectLocalArtemisPlugin: inspect,
    installArtemisPlugin: install,
    removeArtemisPlugin: remove,
    ...overrides,
  });
  const { ResourceCenter } = await import("../src/renderer/ResourceCenter.js");
  const view = render(
    <ResourceCenter
      locale="en"
      onConfirm={async () => true}
      onSettingsChange={() => {}}
    />,
  );
  await screen.findByRole("tab", { name: t.local });
  const add = async () => {
    await user.click(screen.getByRole("button", { name: "Add", exact: true }));
    await user.click(
      screen.getByRole("button", { name: t.inspectLocalPlugin, exact: true }),
    );
  };
  return { user, install, remove, inspect, add, view };
}

it("installs on local add and removes the card after uninstall", async () => {
  const { user, install, remove, add } = await setup();
  await add();
  await waitFor(() =>
    expect(install).toHaveBeenCalledWith(preview.source, expect.any(String)),
  );
  const uninstall = await screen.findByRole("button", {
    name: "Uninstall",
    exact: true,
  });
  expect(
    uninstall
      .closest(".plugin-market-card")
      ?.querySelector(".resource-avatar img"),
  ).toHaveAttribute("src", preview.iconDataUrl);
  expect(
    screen.queryByRole("button", { name: "Install", exact: true }),
  ).toBeNull();
  await user.click(uninstall);
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Uninstall plugin",
    }),
  );
  await waitFor(() => expect(remove).toHaveBeenCalledWith(preview.id));
  await waitFor(() => expect(screen.queryByText("Ocean Skins")).toBeNull());
  expect(
    screen.queryByRole("button", { name: "Install", exact: true }),
  ).toBeNull();
});

it("shows previously installed local plugins and removes them without retaining a preview", async () => {
  const { user } = await setup([installed]);
  await user.click(
    await screen.findByRole("button", { name: "Uninstall", exact: true }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Uninstall plugin",
    }),
  );
  await waitFor(() => expect(screen.queryByText("Ocean Skins")).toBeNull());
});

it("does not install or create a card when directory selection is cancelled", async () => {
  const { inspect, install, add } = await setup();
  inspect.mockResolvedValue(undefined);
  await add();
  expect(inspect).toHaveBeenCalledOnce();
  expect(install).not.toHaveBeenCalled();
  expect(screen.queryByText("Ocean Skins")).toBeNull();
});

it("reports failed installation and allows retry without a leftover card", async () => {
  const { install, add, user } = await setup();
  install.mockRejectedValueOnce(new Error("Synthetic installation failure"));
  await add();
  expect(
    await screen.findByText("Synthetic installation failure"),
  ).toBeVisible();
  expect(screen.queryByText("Ocean Skins")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: t.inspectLocalPlugin, exact: true }),
  );
  await screen.findByRole("button", { name: "Uninstall", exact: true });
  expect(install).toHaveBeenCalledTimes(2);
});

it("does not install unsupported local plugins", async () => {
  const { inspect, install, add } = await setup();
  inspect.mockResolvedValue({
    ...preview,
    installable: false,
    unsupported: ["Unsupported capability"],
  });
  await add();
  expect(await screen.findByText("Unsupported capability")).toBeVisible();
  expect(install).not.toHaveBeenCalled();
});

it("keeps imported marketplace installation explicit and retains its catalog entry after uninstall", async () => {
  const marketplacePlugin: ArtemisPluginPreview = {
    ...preview,
    source: {
      kind: "git",
      marketplaceUrl: "https://github.com/synthetic/shop.git",
      marketplaceName: "shop",
      pluginName: preview.name,
    },
  };
  const importMarketplace = vi.fn(async () => ({
    selectedView: "shop",
    errors: [],
    sources: [
      {
        id: "shop",
        displayName: "Synthetic Shop",
        marketplaceName: "shop",
        url: "https://github.com/synthetic/shop.git",
        repository: "synthetic/shop",
        builtIn: false,
        removable: true,
        offline: true,
        refreshable: false,
        order: 0,
      },
    ],
    marketplaces: [
      {
        sourceId: "shop",
        marketplace: {
          name: "Synthetic Shop",
          marketplaceName: "shop",
          url: "https://github.com/synthetic/shop.git",
          plugins: [marketplacePlugin],
          warnings: [],
        },
      },
    ],
  }));
  const { user, install } = await setup([], {
    inspectOfflineArtemisPluginMarketplace: async () => ({
      path: "/synthetic/shop.zip",
      trust: {
        repository: "synthetic/shop",
        displayName: "Synthetic Shop",
        signingKeyFingerprint: "synthetic-fingerprint",
      },
    }),
    addOfflineArtemisPluginMarketplace: importMarketplace,
  });
  install.mockResolvedValueOnce({
    plugins: [{ ...installed, source: marketplacePlugin.source }],
    skills: [],
    warnings: [],
    settings: { mcpServers: [], trustedExtensions: [] },
  });
  await user.click(screen.getByRole("button", { name: "Add", exact: true }));
  await user.click(
    screen.getByRole("button", {
      name: t.importOfflineMarketplace,
      exact: true,
    }),
  );
  const installButton = await screen.findByRole("button", {
    name: "Install",
    exact: true,
  });
  expect(importMarketplace).toHaveBeenCalledOnce();
  expect(install).not.toHaveBeenCalled();
  await user.click(installButton);
  expect(install).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Install plugin",
    }),
  );
  await waitFor(() =>
    expect(install).toHaveBeenCalledWith(
      marketplacePlugin.source,
      expect.any(String),
    ),
  );
  await user.click(
    await screen.findByRole("button", { name: "Uninstall", exact: true }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Uninstall plugin",
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Install", exact: true }),
  ).toBeVisible();
  expect(screen.getByText("Ocean Skins")).toBeVisible();
});
