// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppLocale } from "@artemis/protocol";
import { describe, expect, it, vi } from "vitest";

import { McpServerEditor } from "../src/renderer/McpServerEditor.js";
import type { McpServerStatus, SettingsSnapshot } from "../src/shared/api.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

// Synthetic data only (PR8 checklist 安全边界 6): every server name, command,
// URL, env value, error message, and the bearer token below is fabricated for
// this file — no real configuration or credential ever appears here.
const syntheticBearer = "synthetic-bearer-token";

const labels = {
  addMcp: "Add MCP server",
  updateMcp: "Update synthetic-stdio-demo MCP",
  launchCommand: "Launch command",
  serverUrl: "Server URL",
  authentication: "Authentication",
  authNone: "None",
  authBearer: "Bearer token",
  bearerField: "Bearer token (optional, encrypted)",
  save: "Save and connect",
  uninstall: "Uninstall",
  back: "Back to MCP servers",
  saving: "Saving…",
  removing: "Removing…",
  tryAgain: "Try again",
  validationHeading: "Fix these issues before saving:",
  validationCommandRequired: "Enter the launch command for the MCP server.",
  validationUrlInvalid: "Enter a valid http:// or https:// server URL.",
  workspace: "Working directory",
  mcpAllowNetwork: "Allow network access",
  mcpFullAccess: "Full local access (compatibility mode)",
  testConnection: "Test connection",
  testConnectionBusy: "Testing the connection…",
  testConnectionSuccess: "Connected.",
  testConnectionFailure: "Connection failed.",
  testSavedOnlyHint: "Tests the saved configuration — save your changes first",
  confirmUninstall:
    "Uninstall synthetic-stdio-demo? This removes the saved configuration only; files on the server are not deleted.",
};

const saveError = "The synthetic MCP host could not be reached.";
const removeError =
  "This server is managed by a plugin and cannot be uninstalled.";
const reconnectError =
  "The synthetic process exited before the MCP handshake completed.";

const stdioServer: McpServerStatus = {
  config: {
    id: "synthetic-stdio-demo",
    name: "synthetic-stdio-demo",
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: ["synthetic-mcp", "--stdio"],
    env: { SYNTHETIC_FLAG: "1" },
    envVars: [],
    workspacePath: "",
    allowNetwork: false,
  },
  state: "connected",
  tools: [],
};

const httpServer: McpServerStatus = {
  config: {
    id: "synthetic-http-demo",
    name: "synthetic-http-demo",
    transport: "streamable-http",
    enabled: true,
    url: "https://mcp.example.test/stream",
    auth: "none",
  },
  state: "disconnected",
  tools: [],
};

const bearerServer: McpServerStatus = {
  config: {
    id: "synthetic-http-demo",
    name: "synthetic-http-demo",
    transport: "streamable-http",
    enabled: true,
    url: "https://mcp.example.test/stream",
    auth: "bearer",
  },
  state: "disconnected",
  tools: [],
};

function snapshotOf(servers: McpServerStatus[]): SettingsSnapshot {
  // McpServerEditor only reads `mcpServers` before forwarding the snapshot to
  // onSaved/onRemoved, so a focused fixture keeps this file readable.
  return { mcpServers: servers } as unknown as SettingsSnapshot;
}

type EditorApi = {
  saveMcpServer: ReturnType<typeof vi.fn>;
  removeMcpServer: ReturnType<typeof vi.fn>;
  reconnectMcpServer: ReturnType<typeof vi.fn>;
};

function renderEditor(
  options: {
    api?: Partial<EditorApi>;
    confirmResult?: boolean;
    server?: McpServerStatus;
  } = {},
) {
  const handlers = {
    onCancel: vi.fn(),
    onConfirm:
      vi.fn<
        (message: string, tone?: "default" | "danger") => Promise<boolean>
      >(),
    onRemoved: vi.fn(),
    onSaved: vi.fn(),
  };
  handlers.onConfirm.mockResolvedValue(options.confirmResult ?? true);
  const api: EditorApi = {
    saveMcpServer: vi.fn(() => Promise.resolve(snapshotOf([stdioServer]))),
    removeMcpServer: vi.fn(() => Promise.resolve(snapshotOf([]))),
    reconnectMcpServer: vi.fn(() =>
      Promise.resolve(snapshotOf([{ ...stdioServer, state: "connected" }])),
    ),
    ...options.api,
  };
  stubWindowArtemis(api);
  const utils = render(
    <McpServerEditor
      existingServers={options.server ? [options.server] : []}
      locale={"en" satisfies AppLocale}
      onCancel={handlers.onCancel}
      onConfirm={handlers.onConfirm}
      onRemoved={handlers.onRemoved}
      onSaved={handlers.onSaved}
      {...(options.server ? { server: options.server } : {})}
    />,
  );
  return {
    ...utils,
    api,
    handlers,
    feedbackWrapper: () =>
      utils.container.querySelector<HTMLElement>(".mcp-editor-feedback"),
    testRegion: () =>
      utils.container.querySelector<HTMLElement>(".mcp-editor-test"),
  };
}

describe("McpServerEditor feedback wiring (D#76 PR8 §10 state matrix)", () => {
  it("switches the heading between new and edit modes and prefills the saved server", () => {
    const newEditor = renderEditor();
    expect(
      screen.getByRole("heading", { name: labels.addMcp }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: labels.uninstall }),
    ).not.toBeInTheDocument();
    const backButton = screen.getByRole("button", { name: labels.back });
    expect(backButton.querySelector("svg")).not.toBeNull();
    expect(backButton).not.toHaveTextContent("←");
    newEditor.unmount();

    renderEditor({ server: stdioServer });
    expect(
      screen.getByRole("heading", { name: labels.updateMcp }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: labels.launchCommand }),
    ).toHaveValue("npx");
    expect(
      screen.getByRole("button", { name: labels.uninstall }),
    ).toBeInTheDocument();
  });

  it("shows the required-command validation alert while keeping Save disabled for a blank new server", () => {
    renderEditor();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(labels.validationHeading);
    expect(alert).toHaveTextContent(labels.validationCommandRequired);
    expect(screen.getByRole("button", { name: labels.save })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: labels.testConnection }),
    ).not.toBeInTheDocument();
  });

  it("flags malformed http URLs in a validation alert without sending any IPC", async () => {
    const api: Partial<EditorApi> = {
      saveMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      reconnectMcpServer: vi.fn(),
    };
    renderEditor({ api, server: httpServer });
    const urlInput = screen.getByRole("textbox", { name: labels.serverUrl });
    const user = userEvent.setup();
    await user.clear(urlInput);
    await user.type(urlInput, "not-a-valid-url");
    expect(screen.getByRole("alert")).toHaveTextContent(
      labels.validationUrlInvalid,
    );
    await user.click(screen.getByRole("button", { name: labels.save }));
    expect(api.saveMcpServer).not.toHaveBeenCalled();
  });

  it("announces saving, marks the form busy, and blocks re-entrant saves", async () => {
    let resolveSave!: (snapshot: SettingsSnapshot) => void;
    const saveMcpServer = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { feedbackWrapper, handlers } = renderEditor({
      api: { saveMcpServer },
    });
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: labels.launchCommand }),
      "npx synthetic-mcp",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: labels.save });
    await user.click(saveButton);
    expect(saveMcpServer).toHaveBeenCalledTimes(1);
    expect(feedbackWrapper()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(labels.saving);
    expect(saveButton).toBeDisabled();
    expect(
      screen.getByRole("button", { name: new RegExp(labels.back, "u") }),
    ).toBeDisabled();
    fireEvent.click(saveButton);
    expect(saveMcpServer).toHaveBeenCalledTimes(1);
    resolveSave(snapshotOf([stdioServer]));
    await waitFor(() => expect(handlers.onSaved).toHaveBeenCalledTimes(1));
    expect(handlers.onSaved).toHaveBeenCalledWith(snapshotOf([stdioServer]));
  });

  it("surfaces save failures in an alert, preserves the draft and bearer, and retries successfully", async () => {
    const saveMcpServer = vi
      .fn()
      .mockRejectedValueOnce(new Error(saveError))
      .mockResolvedValue(snapshotOf([httpServer]));
    const { handlers } = renderEditor({
      api: { saveMcpServer },
      server: httpServer,
    });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: `${labels.authentication} ${labels.authNone}`,
      }),
    );
    await user.click(screen.getByRole("option", { name: labels.authBearer }));
    const bearerInput = screen.getByLabelText(labels.bearerField);
    // jsdom + user-event drops characters when typing into type=password
    // inputs, so set the controlled value deterministically instead.
    fireEvent.change(bearerInput, { target: { value: syntheticBearer } });
    expect(bearerInput).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: labels.save }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(saveError);
    expect(bearerInput).toHaveValue(syntheticBearer);
    expect(screen.getByRole("textbox", { name: labels.serverUrl })).toHaveValue(
      httpServer.config.url,
    );
    await user.click(
      within(alert).getByRole("button", { name: labels.tryAgain }),
    );
    expect(saveMcpServer).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(handlers.onSaved).toHaveBeenCalledTimes(1));
  });

  it("keeps the bearer credential out of alerts, hints, and console output across the drift-gated flow", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const saveMcpServer = vi.fn(() => Promise.reject(new Error(saveError)));
      const reconnectMcpServer = vi.fn(() =>
        Promise.reject(new Error(reconnectError)),
      );
      const { testRegion } = renderEditor({
        api: { saveMcpServer, reconnectMcpServer },
        server: bearerServer,
      });
      const user = userEvent.setup();
      const bearerInput = screen.getByLabelText(labels.bearerField);
      fireEvent.change(bearerInput, { target: { value: syntheticBearer } });
      await user.click(screen.getByRole("button", { name: labels.save }));
      expect(await screen.findByRole("alert")).toHaveTextContent(saveError);
      // A typed bearer is draft drift: the saved-only hint gates the test
      // button, and neither the hint nor any rendered text may echo the
      // credential. The gate must also hold against programmatic clicks.
      const testButton = screen.getByRole("button", {
        name: labels.testConnection,
      });
      expect(testButton).toBeDisabled();
      expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
      expect(document.body.textContent ?? "").not.toContain(syntheticBearer);
      fireEvent.click(testButton);
      expect(reconnectMcpServer).not.toHaveBeenCalled();
      // Clearing the draft credential restores testing against the saved
      // configuration; its failure path must equally stay credential-free.
      fireEvent.change(bearerInput, { target: { value: "" } });
      expect(testButton).toBeEnabled();
      await user.click(testButton);
      const failureAlert = await within(testRegion() as HTMLElement).findByRole(
        "alert",
      );
      expect(failureAlert).toHaveTextContent(reconnectError);
      expect(document.body.textContent ?? "").not.toContain(syntheticBearer);
      const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
        .flat()
        .map((value) => String(value))
        .join(" ");
      expect(logged).not.toContain(syntheticBearer);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("runs the edit-mode test connection through busy and success with exactly one call per attempt", async () => {
    let resolveReconnect!: (snapshot: SettingsSnapshot) => void;
    const reconnectMcpServer = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveReconnect = resolve;
        }),
    );
    const api = { reconnectMcpServer, saveMcpServer: vi.fn() };
    const { feedbackWrapper, handlers, testRegion } = renderEditor({
      api,
      server: stdioServer,
    });
    const user = userEvent.setup();
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    await user.click(testButton);
    expect(reconnectMcpServer).toHaveBeenCalledTimes(1);
    expect(reconnectMcpServer).toHaveBeenCalledWith("synthetic-stdio-demo");
    expect(testRegion()).toHaveAttribute("aria-busy", "true");
    expect(testButton).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      labels.testConnectionBusy,
    );
    expect(feedbackWrapper()).not.toHaveAttribute("aria-busy");
    fireEvent.click(testButton);
    expect(reconnectMcpServer).toHaveBeenCalledTimes(1);
    resolveReconnect(snapshotOf([{ ...stdioServer, state: "connected" }]));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        labels.testConnectionSuccess,
      ),
    );
    expect(testButton).toBeEnabled();
    expect(api.saveMcpServer).not.toHaveBeenCalled();
    expect(handlers.onSaved).not.toHaveBeenCalled();
  });

  it("disables Save and Uninstall while a connection test is pending and blocks overlapping save IPC (mutual exclusion)", async () => {
    let resolveReconnect!: (snapshot: SettingsSnapshot) => void;
    const reconnectMcpServer = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveReconnect = resolve;
        }),
    );
    const saveMcpServer = vi.fn();
    const removeMcpServer = vi.fn();
    const { handlers } = renderEditor({
      api: { reconnectMcpServer, saveMcpServer, removeMcpServer },
      server: stdioServer,
    });
    const user = userEvent.setup();
    const saveButton = screen.getByRole("button", { name: labels.save });
    const uninstallButton = screen.getByRole("button", {
      name: labels.uninstall,
    });
    expect(saveButton).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: labels.testConnection }),
    );
    expect(reconnectMcpServer).toHaveBeenCalledTimes(1);
    expect(saveButton).toBeDisabled();
    expect(uninstallButton).toBeDisabled();
    // Programmatic triggers on the disabled controls must not overlap IPC.
    fireEvent.click(saveButton);
    expect(saveMcpServer).not.toHaveBeenCalled();
    fireEvent.click(uninstallButton);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
    expect(removeMcpServer).not.toHaveBeenCalled();
    resolveReconnect(snapshotOf([{ ...stdioServer, state: "connected" }]));
    await waitFor(() => expect(saveButton).toBeEnabled());
    expect(handlers.onSaved).not.toHaveBeenCalled();
  });

  it("blocks a connection test while saving and asserts zero reconnect IPC (mutual exclusion)", async () => {
    let resolveSave!: (snapshot: SettingsSnapshot) => void;
    const saveMcpServer = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const reconnectMcpServer = vi.fn();
    renderEditor({
      api: { saveMcpServer, reconnectMcpServer },
      server: stdioServer,
    });
    const user = userEvent.setup();
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    await user.click(screen.getByRole("button", { name: labels.save }));
    expect(saveMcpServer).toHaveBeenCalledTimes(1);
    expect(testButton).toBeDisabled();
    fireEvent.click(testButton);
    expect(reconnectMcpServer).not.toHaveBeenCalled();
    resolveSave(snapshotOf([stdioServer]));
    await waitFor(() => expect(testButton).toBeEnabled());
  });

  it("blocks a connection test while removing and asserts zero reconnect IPC (mutual exclusion)", async () => {
    let resolveRemove!: (snapshot: SettingsSnapshot) => void;
    const removeMcpServer = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    const reconnectMcpServer = vi.fn();
    renderEditor({
      api: { removeMcpServer, reconnectMcpServer },
      server: stdioServer,
    });
    const user = userEvent.setup();
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    await user.click(screen.getByRole("button", { name: labels.uninstall }));
    await waitFor(() => expect(removeMcpServer).toHaveBeenCalledTimes(1));
    expect(testButton).toBeDisabled();
    fireEvent.click(testButton);
    expect(reconnectMcpServer).not.toHaveBeenCalled();
    resolveRemove(snapshotOf([]));
    await waitFor(() => expect(testButton).toBeEnabled());
  });

  it("keeps a remove retry from overlapping an in-flight connection test (handler guard)", async () => {
    let resolveReconnect!: (snapshot: SettingsSnapshot) => void;
    const reconnectMcpServer = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveReconnect = resolve;
        }),
    );
    const removeMcpServer = vi
      .fn()
      .mockRejectedValueOnce(new Error(removeError))
      .mockResolvedValue(snapshotOf([]));
    const { handlers } = renderEditor({
      api: { reconnectMcpServer, removeMcpServer },
      server: stdioServer,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: labels.uninstall }));
    await screen.findByText(removeError);
    // The retry affordance stays clickable, so this is the one overlap the
    // editor-level action guard must stop: a remove retry issued while a
    // connection test is in flight must never reach removeMcpServer.
    await user.click(
      screen.getByRole("button", { name: labels.testConnection }),
    );
    expect(reconnectMcpServer).toHaveBeenCalledTimes(1);
    await user.click(
      within(screen.getByRole("alert")).getByRole("button", {
        name: labels.tryAgain,
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      labels.testConnectionBusy,
    );
    expect(removeMcpServer).toHaveBeenCalledTimes(1);
    resolveReconnect(snapshotOf([{ ...stdioServer, state: "connected" }]));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        labels.testConnectionSuccess,
      ),
    );
    // Once the test settles, the retry path works again.
    await user.click(
      within(screen.getByRole("alert")).getByRole("button", {
        name: labels.tryAgain,
      }),
    );
    expect(removeMcpServer).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(handlers.onRemoved).toHaveBeenCalledTimes(1));
  });

  it("reports a failed test connection through an alert and allows an immediate retest", async () => {
    const reconnectMcpServer = vi
      .fn()
      .mockRejectedValueOnce(new Error(reconnectError))
      .mockResolvedValue(snapshotOf([{ ...stdioServer, state: "connected" }]));
    const { testRegion } = renderEditor({
      api: { reconnectMcpServer },
      server: stdioServer,
    });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: labels.testConnection }),
    );
    const failureAlert = await within(testRegion() as HTMLElement).findByRole(
      "alert",
    );
    expect(failureAlert).toHaveTextContent(labels.testConnectionFailure);
    expect(failureAlert).toHaveTextContent(reconnectError);
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(testButton).toBeEnabled();
    await user.click(testButton);
    expect(reconnectMcpServer).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        labels.testConnectionSuccess,
      ),
    );
  });

  it("disables the test connection with the saved-only hint while the URL drifts from the saved config (drift gate)", async () => {
    const api: Partial<EditorApi> = {
      saveMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      reconnectMcpServer: vi.fn(() =>
        Promise.resolve(snapshotOf([{ ...httpServer, state: "connected" }])),
      ),
    };
    renderEditor({ api, server: httpServer });
    const user = userEvent.setup();
    const urlInput = screen.getByRole("textbox", { name: labels.serverUrl });
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(testButton).toBeEnabled();
    fireEvent.change(urlInput, {
      target: { value: "https://mcp.example.test/stream-v2" },
    });
    expect(testButton).toBeDisabled();
    expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
    fireEvent.click(testButton);
    expect(api.reconnectMcpServer).not.toHaveBeenCalled();
    // Reverting the draft re-enables testing against the saved config.
    fireEvent.change(urlInput, { target: { value: httpServer.config.url } });
    expect(testButton).toBeEnabled();
    expect(
      screen.queryByText(labels.testSavedOnlyHint),
    ).not.toBeInTheDocument();
    await user.click(testButton);
    expect(api.reconnectMcpServer).toHaveBeenCalledTimes(1);
    expect(api.saveMcpServer).not.toHaveBeenCalled();
  });

  it("counts a typed bearer token as draft drift without echoing it into the hint (drift gate)", () => {
    renderEditor({ server: bearerServer });
    const bearerInput = screen.getByLabelText(labels.bearerField);
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(testButton).toBeEnabled();
    fireEvent.change(bearerInput, { target: { value: syntheticBearer } });
    expect(testButton).toBeDisabled();
    expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(syntheticBearer);
  });

  it("gates the test connection while stdio arguments drift from the saved config (full drift gate)", async () => {
    const api: Partial<EditorApi> = {
      reconnectMcpServer: vi.fn(() =>
        Promise.resolve(snapshotOf([{ ...stdioServer, state: "connected" }])),
      ),
    };
    renderEditor({ api, server: stdioServer });
    const user = userEvent.setup();
    const argumentInput = screen.getByRole("textbox", {
      name: "Arguments 1",
    });
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(testButton).toBeEnabled();
    fireEvent.change(argumentInput, {
      target: { value: "synthetic-mcp-v2" },
    });
    expect(testButton).toBeDisabled();
    expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
    fireEvent.click(testButton);
    expect(api.reconnectMcpServer).not.toHaveBeenCalled();
    // Reverting the argument restores testing against the saved config.
    fireEvent.change(argumentInput, { target: { value: "synthetic-mcp" } });
    expect(testButton).toBeEnabled();
    expect(
      screen.queryByText(labels.testSavedOnlyHint),
    ).not.toBeInTheDocument();
    await user.click(testButton);
    expect(api.reconnectMcpServer).toHaveBeenCalledTimes(1);
  });

  it("gates the test connection while environment entries and passthrough names drift (full drift gate)", () => {
    renderEditor({ server: stdioServer });
    const valueInput = screen.getByRole("textbox", { name: "Value 1" });
    const passthroughInput = screen.getByRole("textbox", {
      name: "Variable name 1",
    });
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(testButton).toBeEnabled();
    fireEvent.change(valueInput, { target: { value: "2" } });
    expect(testButton).toBeDisabled();
    expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
    // Reverting the value while adding a passthrough name keeps the draft
    // drifted: the saved envVars would change on save.
    fireEvent.change(valueInput, { target: { value: "1" } });
    fireEvent.change(passthroughInput, {
      target: { value: "SYNTHETIC_FLAG" },
    });
    expect(testButton).toBeDisabled();
    fireEvent.change(passthroughInput, { target: { value: "" } });
    expect(testButton).toBeEnabled();
    expect(
      screen.queryByText(labels.testSavedOnlyHint),
    ).not.toBeInTheDocument();
  });

  it("gates the test connection while the working directory drifts (full drift gate)", () => {
    renderEditor({ server: stdioServer });
    const workspaceInput = screen.getByRole("textbox", {
      name: labels.workspace,
    });
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(testButton).toBeEnabled();
    fireEvent.change(workspaceInput, {
      target: { value: "/tmp/synthetic-workspace" },
    });
    expect(testButton).toBeDisabled();
    expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
    fireEvent.change(workspaceInput, { target: { value: "" } });
    expect(testButton).toBeEnabled();
    expect(
      screen.queryByText(labels.testSavedOnlyHint),
    ).not.toBeInTheDocument();
  });

  it("gates the test connection while the permission draft drifts (full drift gate)", async () => {
    renderEditor({ server: stdioServer });
    const user = userEvent.setup();
    const fullAccessToggle = screen.getByRole("switch", {
      name: labels.mcpFullAccess,
    });
    const allowNetworkToggle = screen.getByRole("switch", {
      name: labels.mcpAllowNetwork,
    });
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(testButton).toBeEnabled();
    await user.click(fullAccessToggle);
    expect(testButton).toBeDisabled();
    expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
    // Unchecking full access leaves allowNetwork forced on, so the draft
    // would still save a different permission set than the saved config.
    await user.click(fullAccessToggle);
    expect(allowNetworkToggle).toBeEnabled();
    expect(testButton).toBeDisabled();
    await user.click(allowNetworkToggle);
    expect(testButton).toBeEnabled();
    expect(
      screen.queryByText(labels.testSavedOnlyHint),
    ).not.toBeInTheDocument();
  });

  it("keeps Save disabled while the URL draft is blank or invalid and enables it once valid", async () => {
    const api: Partial<EditorApi> = {
      saveMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      reconnectMcpServer: vi.fn(),
    };
    renderEditor({ api, server: httpServer });
    const user = userEvent.setup();
    const urlInput = screen.getByRole("textbox", { name: labels.serverUrl });
    const saveButton = screen.getByRole("button", { name: labels.save });
    expect(saveButton).toBeEnabled();
    await user.clear(urlInput);
    expect(saveButton).toBeDisabled();
    await user.type(urlInput, "not-a-valid-url");
    expect(saveButton).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      labels.validationUrlInvalid,
    );
    await user.clear(urlInput);
    await user.type(urlInput, "https://mcp.example.test/stream-v2");
    expect(saveButton).toBeEnabled();
    expect(api.saveMcpServer).not.toHaveBeenCalled();
  });

  it("routes Uninstall through the danger confirmation and never removes on denial", async () => {
    const { handlers, api } = renderEditor({
      confirmResult: false,
      server: stdioServer,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: labels.uninstall }));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).toHaveBeenCalledWith(
      labels.confirmUninstall,
      "danger",
    );
    expect(api.removeMcpServer).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: labels.uninstall }),
      ).toBeEnabled(),
    );
    expect(handlers.onRemoved).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it("removes exactly once after confirmation and disables controls while removing", async () => {
    let resolveRemove!: (snapshot: SettingsSnapshot) => void;
    const removeMcpServer = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    const { feedbackWrapper, handlers } = renderEditor({
      api: { removeMcpServer },
      server: stdioServer,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: labels.uninstall }));
    await waitFor(() => expect(removeMcpServer).toHaveBeenCalledTimes(1));
    expect(removeMcpServer).toHaveBeenCalledWith("synthetic-stdio-demo");
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    expect(feedbackWrapper()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(labels.removing);
    expect(screen.getByRole("button", { name: labels.save })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: labels.uninstall }),
    ).toBeDisabled();
    resolveRemove(snapshotOf([]));
    await waitFor(() => expect(handlers.onRemoved).toHaveBeenCalledTimes(1));
  });

  it("reports remove failures with retry while keeping the editor usable", async () => {
    const removeMcpServer = vi
      .fn()
      .mockRejectedValueOnce(new Error(removeError))
      .mockResolvedValue(snapshotOf([]));
    const { handlers } = renderEditor({
      api: { removeMcpServer },
      server: stdioServer,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: labels.uninstall }));
    await waitFor(() => expect(removeMcpServer).toHaveBeenCalledTimes(1));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(removeError);
    expect(handlers.onRemoved).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: labels.uninstall }),
    ).toBeEnabled();
    await user.click(
      within(alert).getByRole("button", { name: labels.tryAgain }),
    );
    expect(removeMcpServer).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(handlers.onRemoved).toHaveBeenCalledTimes(1));
  });
});
