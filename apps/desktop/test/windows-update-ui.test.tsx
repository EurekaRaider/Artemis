// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SettingsPanel } from "../src/renderer/SettingsPanel.js";
import type { SettingsSnapshot } from "../src/shared/api.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

it("opens the Windows ZIP in the browser and explains manual replacement without installing", async () => {
  const settings = {
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
        "https://github.com/EurekaRaider/ArtemisRelease/releases/download/v1.1.0/Artemis-Windows-x64-1.1.0.zip",
    },
  } as unknown as SettingsSnapshot;
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
