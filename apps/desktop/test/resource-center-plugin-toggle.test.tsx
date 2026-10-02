// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceCenter } from "../src/renderer/ResourceCenter.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

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
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  vi.unstubAllGlobals();
});

describe("Installed plugin toggle", () => {
  it("allows disabling an enabled plugin that is no longer installable", async () => {
    const plugin = {
      id: "retired-github",
      name: "github",
      displayName: "GitHub",
      version: "1.0.0",
      description: "Retired plugin",
      installed: true,
      installable: false,
      source: { kind: "local", path: "/synthetic/github" },
      skills: [],
      mcpServers: [],
      apps: [],
      unsupported: [],
      warnings: [],
      skillNames: [],
      mcpServerIds: ["github-mcp"],
    };
    const config = {
      id: "github-mcp",
      name: "GitHub",
      transport: "streamable-http",
      enabled: true,
      url: "https://example.test/mcp",
      auth: "none",
    };
    const setEnabled = vi.fn(async () => ({
      plugins: [plugin],
      skills: [],
      warnings: [],
      settings: {
        mcpServers: [
          { config: { ...config, enabled: false }, state: "disabled" },
        ],
      },
    }));
    stubWindowArtemis({
      listArtemisPlugins: async () => [plugin],
      listInstalledSkills: async () => [],
      listMcpServers: async () => [{ config, state: "disconnected" }],
      getArtemisPluginMarketplaces: async () => ({
        sources: [],
        marketplaces: [],
        errors: [],
        selectedView: "local",
      }),
      loadBundledPluginMarketplace: async () => undefined,
      onResourceInstallProgress: () => () => {},
      setArtemisPluginEnabled: setEnabled,
    });
    render(
      <ResourceCenter
        locale="en"
        onConfirm={async () => true}
        onSettingsChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Manage installed capabilities" }),
    );
    const toggle = await screen.findByRole("switch", { name: "Enabled" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(setEnabled).toHaveBeenCalledWith(plugin.id, false),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Disabled" })).toBeDisabled(),
    );
  });
});

describe("MCP configuration toggles", () => {
  it("shows enabled failed servers and keeps independent pending rows locked", async () => {
    const servers = ["first", "second"].map((id) => ({
      config: {
        id,
        name: id,
        transport: "streamable-http",
        enabled: true,
        url: "https://example.test/mcp",
        auth: "none",
      },
      state: "failed",
      error: "Synthetic startup failure",
      tools: [],
    }));
    const finish: Array<() => void> = [];
    const setEnabled = vi.fn(
      (id: string, enabled: boolean) =>
        new Promise((resolve) => {
          finish.push(() =>
            resolve({
              mcpServers: servers.map((server) =>
                server.config.id === id
                  ? { ...server, config: { ...server.config, enabled } }
                  : server,
              ),
            }),
          );
        }),
    );
    stubWindowArtemis({
      listMcpServers: async () => servers,
      listArtemisPlugins: async () => [],
      listInstalledSkills: async () => [],
      getArtemisPluginMarketplaces: async () => ({
        sources: [],
        marketplaces: [],
        errors: [],
        selectedView: "local",
      }),
      loadBundledPluginMarketplace: async () => undefined,
      onResourceInstallProgress: () => () => {},
      setMcpServerEnabled: setEnabled,
    });
    render(
      <ResourceCenter
        locale="en"
        onConfirm={async () => true}
        onSettingsChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Manage installed capabilities" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    const toggles = await screen.findAllByRole("switch");
    expect(toggles[0]).toBeChecked();
    expect(toggles[1]).toBeChecked();
    fireEvent.click(toggles[0]!);
    expect(toggles[0]).toBeDisabled();
    expect(toggles[1]).toBeEnabled();
    fireEvent.click(toggles[1]!);
    expect(setEnabled).toHaveBeenCalledTimes(2);
    expect(toggles[0]).toBeDisabled();
    expect(toggles[1]).toBeDisabled();
    await act(async () => finish[0]!());
    expect(toggles[0]).toBeEnabled();
    expect(toggles[1]).toBeDisabled();
    await act(async () => finish[1]!());
    expect(toggles[1]).toBeEnabled();
  });
});
