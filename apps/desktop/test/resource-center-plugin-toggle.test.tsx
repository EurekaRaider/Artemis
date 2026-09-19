// @vitest-environment jsdom
import {
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
      listCodexPlugins: async () => [plugin],
      listInstalledSkills: async () => [],
      listMcpServers: async () => [{ config, state: "disconnected" }],
      getCodexPluginMarketplaces: async () => ({
        sources: [],
        marketplaces: [],
        errors: [],
        selectedView: "local",
      }),
      loadCodexRuntimeMarketplace: async () => undefined,
      onResourceInstallProgress: () => () => {},
      setCodexPluginEnabled: setEnabled,
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
