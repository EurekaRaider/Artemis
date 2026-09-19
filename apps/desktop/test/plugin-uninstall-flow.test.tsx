// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ResourceCenter } from "../src/renderer/ResourceCenter.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  vi.unstubAllGlobals();
});

it("requires explicit plugin confirmation from both uninstall entry points", async () => {
  const user = userEvent.setup();
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
  const plugin = {
    id: "github-plugin",
    name: "github",
    displayName: "GitHub",
    version: "1.0.0",
    description: "Repository tools",
    source: { kind: "local", path: "/synthetic/github" },
    installed: true,
    installable: true,
    skills: [],
    mcpServers: [],
    apps: [],
    unsupported: [],
    warnings: [],
    skillNames: [],
    mcpServerIds: [],
  };
  const settings = { mcpServers: [], trustedExtensions: [] };
  let finishRemoval!: () => void;
  const remove = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    return { plugins: [], skills: [], warnings: [], settings };
  });
  const confirm = vi.fn(async () => true);
  const changed = vi.fn();
  stubWindowArtemis({
    listCodexPlugins: async () => [plugin],
    listInstalledSkills: async () => [],
    listMcpServers: async () => [],
    getCodexPluginMarketplaces: async () => ({
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
      selectedView: "shop",
    }),
    loadCodexRuntimeMarketplace: async () => undefined,
    onResourceInstallProgress: () => () => {},
    removeCodexPlugin: remove,
  });
  render(
    <ResourceCenter
      locale="en"
      onConfirm={confirm}
      onSettingsChange={changed}
    />,
  );

  const marketUninstall = await screen.findByRole("button", {
    name: "Uninstall",
    exact: true,
  });
  for (const dismissal of ["Cancel", "Close", "Escape"]) {
    await user.click(marketUninstall);
    const dialog = screen.getByRole("alertdialog", {
      name: "Uninstall GitHub",
    });
    expect(dialog).toHaveAccessibleDescription(
      /managed Skills, Connectors and MCP configurations.*cannot be undone/,
    );
    expect(
      within(dialog).getByRole("button", { name: "Uninstall plugin" }),
    ).not.toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
    if (dismissal === "Escape") {
      fireEvent(
        dialog,
        new Event("cancel", { bubbles: false, cancelable: true }),
      );
    } else {
      await user.click(within(dialog).getByRole("button", { name: dismissal }));
    }
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(marketUninstall).toHaveFocus();
  }

  await user.click(
    screen.getByRole("button", { name: "Manage installed capabilities" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Uninstall GitHub" }),
  );
  const dialog = screen.getByRole("alertdialog", { name: "Uninstall GitHub" });
  await user.dblClick(
    within(dialog).getByRole("button", { name: "Uninstall plugin" }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(remove).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith(plugin.id);
  expect(confirm).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  finishRemoval();
  await waitFor(() => expect(changed).toHaveBeenCalledWith(settings));
  expect(screen.queryByRole("button", { name: "Uninstall GitHub" })).toBeNull();
  expect(screen.getByText("Plugin uninstalled.")).toBeVisible();
});
