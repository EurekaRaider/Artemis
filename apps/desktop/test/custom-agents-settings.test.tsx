// @vitest-environment jsdom
// Renderer coverage for the custom sub-agent settings section (D#152 PR4):
// list mounted in the tab with an overlay editor dialog (issue #193),
// catalog rendering with policy badges, validated create/edit round-trips,
// clean cancel plus dirty-discard guard, enable toggle, two-step delete,
// revision-conflict handling, and the capability preview wiring that
// reuses the runtime intersection.
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CustomAgentDefinition } from "@artemis/protocol";

import { CustomAgentsSettingsSection } from "../src/renderer/CustomAgentsSettingsSection.js";
import type {
  CustomAgentSummary,
  SettingsSnapshot,
} from "../src/shared/api.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

function settingsSnapshot(
  overrides: Record<string, unknown> = {},
): SettingsSnapshot {
  return {
    platform: "darwin",
    encryptionAvailable: true,
    language: "system",
    theme: "system",
    resolvedLocale: "en",
    approvalPolicy: "ask",
    localFullAccess: false,
    shell: { windowsPreference: "auto", profileMode: "environment" },
    fullAccessAvailable: false,
    contextWindow: 258_000,
    models: [],
    addedModels: [],
    credentials: [],
    providers: [],
    mcpServers: [],
    globalAgents: { path: "/tmp/agents.md", content: "" },
    trustedExtensions: [],
    update: {
      state: "idle",
      currentVersion: "0.0.0-synthetic",
      rollbackAvailable: false,
    },
    agentConcurrency: {
      preference: { mode: "auto" },
      configuredLimit: 8,
      automaticSafeLimit: 8,
      startupLimit: 8,
      effectiveLimit: 8,
      active: 0,
      waiting: 0,
      queued: 0,
      hardLimit: 8,
      logicalLimit: 8,
      throttled: false,
      pressureReasons: [],
      parallelism: 1,
      totalMemoryGiB: 16,
    },
    customAgents: [],
    ...overrides,
  } as unknown as SettingsSnapshot;
}

const summary: CustomAgentSummary = {
  id: "def-1",
  revision: 3,
  name: "Reviewer",
  description: "Reviews diffs",
  color: "blue",
  enabled: true,
  scope: "all",
  projectIds: [],
  modelPolicy: { kind: "inherit" },
  thinkingPolicy: { kind: "inherit" },
  toolPolicy: {
    kind: "allowlist",
    tools: [{ kind: "builtin", toolId: "write" }],
  },
  allowAutomaticInvocation: false,
  triggers: ["review"],
  createdAt: 1,
  updatedAt: 2,
};

const definition: CustomAgentDefinition = {
  id: "def-1",
  revision: 3,
  name: "Reviewer",
  description: "Reviews diffs",
  color: "blue",
  enabled: true,
  instructions: "Focus on correctness.",
  scope: "all",
  modelPolicy: { kind: "inherit" },
  thinkingPolicy: { kind: "inherit" },
  toolPolicy: {
    kind: "allowlist",
    tools: [{ kind: "builtin", toolId: "write" }],
  },
  allowAutomaticInvocation: false,
  triggers: ["review"],
  createdAt: 1,
  updatedAt: 2,
};

interface RenderOptions {
  snapshotOverrides?: Record<string, unknown>;
  api?: Record<string, unknown>;
}

function renderSection(options: RenderOptions = {}) {
  const snapshot = settingsSnapshot({
    customAgents: [summary],
    ...options.snapshotOverrides,
  });
  const applySettings = vi.fn();
  const setBusy = vi.fn();
  const api = {
    customAgentsGet: vi.fn(async () => definition),
    customAgentsCreate: vi.fn(async () => snapshot),
    customAgentsUpdate: vi.fn(async () => snapshot),
    customAgentsDelete: vi.fn(async () => snapshot),
    customAgentsPreviewCapabilities: vi.fn(async () => ({
      mode: "execute",
      capabilities: ["filesystem-read"],
    })),
    getSettings: vi.fn(async () => snapshot),
    ...options.api,
  };
  stubWindowArtemis(api);
  render(
    <CustomAgentsSettingsSection
      applySettings={applySettings}
      busy={false}
      locale="en"
      projects={[]}
      setBusy={setBusy}
      settings={snapshot}
    />,
  );
  return { api, applySettings, snapshot };
}

describe("CustomAgentsSettingsSection", () => {
  it("shows the dashed empty state as the only create entry point", () => {
    renderSection({ snapshotOverrides: { customAgents: [] } });
    expect(screen.getByText("No custom sub-agents yet")).toBeInTheDocument();
    expect(screen.getByText(/Create a specialist role once/u)).toBeVisible();
    const empty = screen
      .getByText("No custom sub-agents yet")
      .closest("[data-artemis-component='empty-state']");
    expect(empty?.className).toContain("custom-agent-empty");
    // While empty, the header count chip and create button stay hidden —
    // the dashed box owns the single creation entry point.
    expect(
      screen.getAllByRole("button", { name: "New sub-agent" }).length,
    ).toBe(1);
    expect(screen.queryByText("0 item(s)")).toBeNull();
  });

  it("lists definitions with policy, scope, state, and routing badges", () => {
    renderSection();
    const row = screen
      .getByText("Reviewer", { selector: '[data-part="title"]' })
      .closest("article");
    expect(row).not.toBeNull();
    const scoped = within(row as HTMLElement);
    expect(scoped.getByText("Reviews diffs")).toBeInTheDocument();
    expect(scoped.getByText("Inherit")).toBeInTheDocument();
    expect(scoped.getByText("1 tools")).toBeInTheDocument();
    expect(scoped.getByText("All projects")).toBeInTheDocument();
    expect(scoped.getByText("Manual only")).toBeInTheDocument();
    expect(row?.querySelector(".custom-agent-color-blue")).not.toBeNull();
    // Enabled definitions keep the disabled badge hidden.
    expect(scoped.queryByText("Disabled")).toBeNull();
    expect(screen.getByText("1 item(s)")).toBeInTheDocument();
  });

  it("deduplicates repeated models instead of crashing the fixed-model picker", async () => {
    const user = userEvent.setup();
    // The settings snapshot can repeat a provider/model pair (builtin plus
    // manually added) and repeat display names; the public Select contract
    // rejects duplicate option values/labels and used to unmount the whole
    // dialog with an error as soon as a fixed policy rendered its picker.
    const fixedPolicy = { kind: "fixed", providerId: "p1", modelId: "m1" };
    renderSection({
      snapshotOverrides: {
        models: [
          {
            providerId: "p1",
            modelId: "m1",
            name: "Model One",
            configured: true,
          },
          {
            providerId: "p1",
            modelId: "m1",
            name: "Model One",
            configured: true,
          },
          {
            providerId: "p2",
            modelId: "m2",
            name: "Model One",
            configured: true,
          },
          {
            providerId: "p1",
            modelId: "m3",
            name: "model  one",
            configured: true,
          },
          {
            providerId: "p1",
            modelId: "M3",
            name: "MODEL ONE",
            configured: true,
          },
        ],
        addedModels: [
          { providerId: "p1", modelId: "m1", contextWindow: 128_000 },
          { providerId: "p1", modelId: "m1", contextWindow: 128_000 },
          { providerId: "p2", modelId: "m2", contextWindow: 128_000 },
          { providerId: "p1", modelId: "m3", contextWindow: 128_000 },
          { providerId: "p1", modelId: "M3", contextWindow: 128_000 },
        ],
        customAgents: [{ ...summary, modelPolicy: fixedPolicy }],
      },
      api: {
        customAgentsGet: vi.fn(async () => ({
          ...definition,
          modelPolicy: fixedPolicy,
        })),
      },
    });
    await user.click(screen.getByRole("button", { name: "Edit" }));

    // Rendering this far means the deduplicated options passed Select's
    // contract validation instead of throwing.
    expect(
      await screen.findByText("Edit: Reviewer", { selector: "h3" }),
    ).toBeInTheDocument();
  });

  it("offers only added models even when other catalog models share configured credentials", async () => {
    const user = userEvent.setup();
    const { api } = renderSection({
      snapshotOverrides: {
        addedModels: [
          { providerId: "p2", modelId: "org/model", contextWindow: 128_000 },
        ],
        models: [
          {
            providerId: "p2",
            modelId: "catalog",
            name: "Catalog only",
            configured: true,
          },
          {
            providerId: "p2",
            modelId: "org/model",
            name: "Configured model",
            configured: true,
          },
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Model Inherit from parent session",
      }),
    );
    await user.click(screen.getByRole("option", { name: "Fixed model" }));
    expect(
      screen.getByRole("button", { name: "Save sub-agent" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", {
        name: "Fixed model Choose a configured model",
      }),
    );
    expect(screen.queryByRole("option", { name: /Catalog only/ })).toBeNull();
    expect(
      screen
        .getAllByRole("option")
        .filter((option) => option.getAttribute("aria-disabled") !== "true"),
    ).toHaveLength(1);
    await user.type(screen.getByRole("combobox"), "Configured");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save sub-agent" }));
    expect(api.customAgentsUpdate).toHaveBeenCalledWith(
      "def-1",
      3,
      expect.objectContaining({
        modelPolicy: { kind: "fixed", providerId: "p2", modelId: "org/model" },
      }),
    );
  });

  it("explains unavailable saved models and blocks saving until resolved", async () => {
    const user = userEvent.setup();
    renderSection({
      api: {
        customAgentsGet: vi.fn(async () => ({
          ...definition,
          modelPolicy: { kind: "fixed", providerId: "gone", modelId: "old" },
        })),
      },
    });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      await screen.findByText(/This model is no longer configured/),
    ).toBeVisible();
    expect(screen.getByText(/Configure a model in Settings/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save sub-agent" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Model Fixed model" }));
    await user.click(
      screen.getByRole("option", { name: "Inherit from parent session" }),
    );
    expect(
      screen.getByRole("button", { name: "Save sub-agent" }),
    ).toBeEnabled();
  });

  it("shows partial MCP grants and lets the user revoke them in one click", async () => {
    const user = userEvent.setup();
    const { api } = renderSection({
      snapshotOverrides: {
        mcpServers: [
          {
            config: { id: "server-1", name: "Docs" },
            tools: [
              { serverId: "server-1", toolName: "read" },
              { serverId: "server-1", toolName: "write" },
            ],
          },
        ],
      },
      api: {
        customAgentsGet: vi.fn(async () => ({
          ...definition,
          toolPolicy: {
            kind: "allowlist",
            tools: [{ kind: "mcp", serverId: "server-1", toolName: "read" }],
          },
        })),
      },
    });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const server = await screen.findByRole("checkbox", { name: /Docs/u });
    expect(server).toBeChecked();
    expect(screen.getByText("1 of 2 tools selected")).toBeVisible();
    await user.click(server);
    await user.click(screen.getByRole("button", { name: "Save sub-agent" }));
    expect(api.customAgentsUpdate).toHaveBeenCalledWith(
      "def-1",
      3,
      expect.objectContaining({ toolPolicy: { kind: "allowlist", tools: [] } }),
    );
  });

  it("labels the fixed model with its configured model id", () => {
    renderSection({
      snapshotOverrides: {
        models: [{ providerId: "p1", modelId: "m1", name: "Model One" }],
        customAgents: [
          {
            ...summary,
            modelPolicy: { kind: "fixed", providerId: "p1", modelId: "m1" },
          },
        ],
      },
    });
    expect(screen.getByText("Model One")).toBeInTheDocument();
  });

  it("warns when the automatic set exceeds the per-turn catalog budget", () => {
    const overflow = Array.from({ length: 21 }, (_, index) => ({
      ...summary,
      id: `def-${index}`,
      name: `Agent ${index}`,
      allowAutomaticInvocation: true,
    }));
    renderSection({ snapshotOverrides: { customAgents: overflow } });
    expect(
      screen.getByText(/Automatic routing is paused for over-budget turns/u),
    ).toBeInTheDocument();
  });

  it("keeps the budget warning hidden when the automatic set fits", () => {
    renderSection({
      snapshotOverrides: {
        customAgents: [{ ...summary, allowAutomaticInvocation: true }],
      },
    });
    expect(
      screen.queryByText(/Automatic routing is paused for over-budget turns/u),
    ).toBeNull();
  });

  it("creates a definition from the dialog and keeps the list mounted", async () => {
    const user = userEvent.setup();
    const { api, applySettings, snapshot } = renderSection();
    await user.click(screen.getByRole("button", { name: "New sub-agent" }));

    // The editor is an overlay dialog now (issue #193) — the list behind it
    // stays mounted while editing.
    expect(screen.getByText("Reviews diffs")).toBeInTheDocument();
    expect(
      screen.getByText("New sub-agent", { selector: "h3" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/saving returns to the list/u)).toBeInTheDocument();

    // Opening the editor asks the main process for the effective-capability
    // preview with the widest mode.
    await waitFor(() =>
      expect(api.customAgentsPreviewCapabilities).toHaveBeenCalledWith(
        { toolPolicy: { kind: "inherit" } },
        "execute",
      ),
    );

    await user.type(screen.getByLabelText("Name"), "Docs writer");

    // Local validation mirrors CUSTOM_AGENT_INVALID: an empty prompt blocks
    // the save with a field error instead of an IPC rejection.
    await user.click(screen.getByRole("button", { name: "Save sub-agent" }));
    expect(
      screen.getByText("The dedicated prompt is required"),
    ).toBeInTheDocument();
    expect(api.customAgentsCreate).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText("Dedicated prompt"),
      "Write concise docs.",
    );
    await user.click(screen.getByRole("button", { name: "Save sub-agent" }));

    await waitFor(() =>
      expect(api.customAgentsCreate).toHaveBeenCalledTimes(1),
    );
    const input = api.customAgentsCreate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(input).toMatchObject({
      name: "Docs writer",
      instructions: "Write concise docs.",
      enabled: true,
      scope: "all",
      projectIds: [],
      modelPolicy: { kind: "inherit" },
      thinkingPolicy: { kind: "inherit" },
      toolPolicy: { kind: "inherit" },
      allowAutomaticInvocation: false,
      triggers: [],
    });
    expect(applySettings).toHaveBeenCalledWith(snapshot);
    // A successful save closes the dialog and leaves the list on screen.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save sub-agent" }),
      ).toBeNull(),
    );
    expect(screen.getByText("Reviews diffs")).toBeInTheDocument();
  });

  it("saves long dedicated instructions intact and distinguishes storage from token estimates", async () => {
    const user = userEvent.setup();
    const { api } = renderSection();
    await user.click(screen.getByRole("button", { name: "New sub-agent" }));
    expect(
      screen.getByText(/0.0 KiB stored.*approximately 0 tokens/u),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Name"), "Long instructions");
    const instructions = "字".repeat(30000);
    fireEvent.change(screen.getByLabelText("Dedicated prompt"), {
      target: { value: instructions },
    });
    expect(
      screen.getByText(/87.9 KiB stored.*approximately 30000 tokens/u),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save sub-agent" }));
    await waitFor(() =>
      expect(api.customAgentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ instructions }),
      ),
    );
  });

  it("closes a clean dialog through cancel without saving", async () => {
    const user = userEvent.setup();
    const { api } = renderSection();
    await user.click(screen.getByRole("button", { name: "New sub-agent" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.customAgentsCreate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByText("Reviews diffs")).toBeInTheDocument();
  });

  it("closes a dirty dialog through cancel and discards without saving", async () => {
    const user = userEvent.setup();
    const { api } = renderSection();
    await user.click(screen.getByRole("button", { name: "New sub-agent" }));
    await user.type(screen.getByLabelText("Name"), "Discarded");

    // Cancel closes immediately even with unsaved changes; nothing is created.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.customAgentsCreate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByText("Reviews diffs")).toBeInTheDocument();
  });

  it("loads the full definition for editing and saves with its revision", async () => {
    const user = userEvent.setup();
    const { api } = renderSection();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() =>
      expect(api.customAgentsGet).toHaveBeenCalledWith("def-1"),
    );
    expect(
      screen.getByText("Edit: Reviewer", { selector: "h3" }),
    ).toBeInTheDocument();
    const instructions = await screen.findByLabelText("Dedicated prompt");
    expect(instructions).toHaveValue("Focus on correctness.");

    await user.click(screen.getByRole("button", { name: "Save sub-agent" }));
    await waitFor(() =>
      expect(api.customAgentsUpdate).toHaveBeenCalledTimes(1),
    );
    const [id, revision, input] = api.customAgentsUpdate.mock.calls[0] as [
      string,
      number,
      Record<string, unknown>,
    ];
    expect(id).toBe("def-1");
    expect(revision).toBe(3);
    expect(input).toMatchObject({
      name: "Reviewer",
      instructions: "Focus on correctness.",
      triggers: ["review"],
      toolPolicy: {
        kind: "allowlist",
        tools: [{ kind: "builtin", toolId: "write" }],
      },
    });
  });

  it("toggles enabled through a full-definition read plus revision update", async () => {
    const user = userEvent.setup();
    const { api } = renderSection();
    await user.click(screen.getByRole("switch", { name: "Reviewer" }));

    await waitFor(() =>
      expect(api.customAgentsUpdate).toHaveBeenCalledTimes(1),
    );
    expect(api.customAgentsGet).toHaveBeenCalledWith("def-1");
    const [id, revision, input] = api.customAgentsUpdate.mock.calls[0] as [
      string,
      number,
      Record<string, unknown>,
    ];
    expect(id).toBe("def-1");
    expect(revision).toBe(3);
    expect(input).toMatchObject({ enabled: false, name: "Reviewer" });
  });

  it("requires a second confirmation step before deleting", async () => {
    const user = userEvent.setup();
    const { api, applySettings, snapshot } = renderSection();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.customAgentsDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete?" }));
    await waitFor(() =>
      expect(api.customAgentsDelete).toHaveBeenCalledWith("def-1"),
    );
    expect(applySettings).toHaveBeenCalledWith(snapshot);
  });

  it("keeps the editor open and refreshes the snapshot on revision conflict", async () => {
    const user = userEvent.setup();
    const getSettings = vi.fn(async () => settingsSnapshot());
    const api = {
      customAgentsUpdate: vi.fn(async () => {
        throw new Error("CUSTOM_AGENT_REVISION_CONFLICT");
      }),
      getSettings,
    };
    const { applySettings } = renderSection({ api });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByLabelText("Dedicated prompt");
    await user.click(screen.getByRole("button", { name: "Save sub-agent" }));

    await waitFor(() =>
      expect(screen.getByText(/edited elsewhere/)).toBeInTheDocument(),
    );
    // The snapshot refresh keeps the next save aimed at the live revision.
    expect(getSettings).toHaveBeenCalled();
    expect(applySettings).toHaveBeenCalled();
    // Form content stays put so the user can review and retry.
    expect(
      screen.getByRole("button", { name: "Save sub-agent" }),
    ).toBeInTheDocument();
  });
});
