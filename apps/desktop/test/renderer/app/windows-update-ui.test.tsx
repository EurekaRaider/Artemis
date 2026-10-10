// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPanel } from "../../../src/renderer/app/SettingsPanel.js";
import { App } from "../../../src/renderer/app/App.js";
import type { SettingsSnapshot } from "../../../src/shared/api.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { changeLanguage: vi.fn() } }),
}));
vi.mock("../../../src/renderer/appearance/desktop-skin-bootstrap.js", () => ({
  desktopSkinHost: { setTheme: vi.fn() },
  desktopSkinReady: Promise.resolve(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem("artemis-sidebar-open");
});

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

it("shows a failed installation in maintenance instead of a successful download notice", async () => {
  const settings = fixture();
  settings.update = {
    state: "downloaded",
    currentVersion: "1.0.0",
    availableVersion: "1.1.0",
    rollbackAvailable: false,
    message: "Update recovery helper exited (1) before becoming ready",
  };
  stubWindowArtemis({
    getSettings: async () => settings,
    onUpdateStatus: () => () => {},
  });
  render(
    <SettingsPanel
      locale="en"
      initialTab="maintenance"
      initialSettings={settings}
      onClose={() => {}}
      onSettingsChange={() => {}}
    />,
  );
  expect(await screen.findByText(settings.update.message)).toBeInTheDocument();
  expect(
    screen.queryByText("Download complete. Restart to install."),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Install update" })).toBeEnabled();
});

it("keeps the sidebar installation failure visible and supports retry", async () => {
  vi.stubGlobal("requestIdleCallback", () => 0);
  vi.stubGlobal("cancelIdleCallback", () => {});
  localStorage.setItem(
    "artemis-sidebar-open",
    JSON.stringify({ protocolVersion: 1, value: true }),
  );
  const settings = fixture();
  settings.update = {
    state: "downloaded",
    currentVersion: "1.0.0",
    availableVersion: "1.1.0",
    rollbackAvailable: false,
  };
  let updateStatus: ((value: SettingsSnapshot["update"]) => void) | undefined;
  const errorMessage =
    "Update recovery helper exited (1) before becoming ready";
  const installUpdate = vi
    .fn()
    .mockImplementationOnce(async () => {
      updateStatus?.({ ...settings.update, message: errorMessage });
      throw new Error(errorMessage);
    })
    .mockImplementationOnce(async () => {
      updateStatus?.({ ...settings.update, message: "" });
    });
  const pending = new Promise(() => {});
  const handlers: Record<string, unknown> = {
    getSnapshot: async () => ({
      projects: [],
      threads: [],
      worktrees: [],
      events: {},
      locale: "en",
      platform: "win32",
      userName: "Update Test",
      sandbox: { available: true },
    }),
    getSettings: async () => settings,
    onUpdateStatus: (callback: typeof updateStatus) => {
      updateStatus = callback;
      return () => {};
    },
    installUpdate,
  };
  stubWindowArtemis(
    new Proxy(handlers, {
      get(target, key) {
        if (String(key) in target) return target[String(key)];
        if (String(key).startsWith("on")) return () => () => {};
        return () => pending;
      },
    }),
  );
  const { container } = render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Install update" }),
  );
  const footer = container.querySelector(".sidebar-footer")! as HTMLElement;
  expect(await within(footer).findByRole("alert")).toHaveTextContent(
    errorMessage,
  );
  expect(
    within(footer).getByRole("button", { name: "Install update" }),
  ).toBeEnabled();
  await act(async () => {
    fireEvent.click(
      within(footer).getByRole("button", { name: "Install update" }),
    );
  });
  expect(installUpdate).toHaveBeenCalledTimes(2);
  expect(within(footer).queryByRole("alert")).not.toBeInTheDocument();
  expect(within(footer).getByRole("status")).toHaveTextContent(
    "Installing update",
  );
});
