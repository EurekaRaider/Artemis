// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SettingsPanel } from "../../../src/renderer/app/SettingsPanel.js";
import type { SettingsSnapshot } from "../../../src/shared/api.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

function fixture(): SettingsSnapshot {
  return {
    platform: "win32",
    encryptionAvailable: true,
    language: "en",
    resolvedLocale: "en",
    theme: "system",
    approvalPolicy: "ask",
    localFullAccess: false,
    fullAccessAvailable: false,
    shell: { windowsPreference: "auto", profileMode: "environment" },
    contextWindow: 128000,
    models: [],
    addedModels: [],
    credentials: [],
    providers: [],
    mcpServers: [],
    trustedExtensions: [],
    customAgents: [],
    globalAgents: { path: "fixture", content: "" },
    agentConcurrency: { preference: { mode: "auto" }, configuredLimit: 8 },
    update: {
      state: "available",
      currentVersion: "1.0.0",
      availableVersion: "1.1.0",
      rollbackAvailable: false,
      manualUpdate: true,
      manualDownloadUrl:
        "https://github.com/EurekaRaider/Artemis/releases/download/v1.1.0/Artemis-Windows-x64-1.1.0.zip",
    },
  } as unknown as SettingsSnapshot;
}

it("opens the Windows ZIP in the browser and explains manual replacement without installing", async () => {
  const settings = fixture();
  const downloadUpdate = vi.fn(),
    installUpdate = vi.fn();
  stubWindowArtemis({
    getSettings: async () => settings,
    onUpdateStatus: () => () => {},
    downloadUpdate,
    installUpdate,
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  try {
    render(
      <SettingsPanel
        locale="en"
        initialTab="maintenance"
        initialSettings={settings}
        onClose={() => {}}
        onSettingsChange={() => {}}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Download ZIP in browser" }),
    );
    expect(open).toHaveBeenCalledWith(
      settings.update.manualDownloadUrl,
      "_blank",
      "noopener,noreferrer",
    );
    expect(
      screen.getByText(/Quit Artemis before switching/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install update" }),
    ).not.toBeInTheDocument();
    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();
  } finally {
    open.mockRestore();
  }
});

it.each([false, true])(
  "only reports the latest version after a successful check: %s",
  async (upToDate) => {
    const settings = fixture();
    settings.update = {
      state: "idle",
      currentVersion: "1.6.8",
      rollbackAvailable: false,
      upToDate,
    };
    stubWindowArtemis({
      getSettings: async () => settings,
      onUpdateStatus: () => () => {},
    });
    render(
      <SettingsPanel
        locale="zh-CN"
        initialTab="maintenance"
        initialSettings={settings}
        onClose={() => {}}
        onSettingsChange={() => {}}
      />,
    );
    expect(screen.queryByText(/当前Artemis已经是最新版本/) !== null).toBe(
      upToDate,
    );
  },
);
