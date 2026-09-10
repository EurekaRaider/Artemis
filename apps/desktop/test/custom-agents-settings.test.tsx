// @vitest-environment jsdom
// Renderer coverage for the custom sub-agent settings section (D#152 PR4):
// catalog rendering, validated create/edit round-trips, enable toggle,
// two-step delete, revision-conflict handling, and the capability preview
// wiring that reuses the runtime intersection.
import { render, screen, waitFor, within } from "@testing-library/react";
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
  toolPolicy: { kind: "inherit" },
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
  it("shows the empty state until a definition exists", () => {
    renderSection({ snapshotOverrides: { customAgents: [] } });
    expect(screen.getByText("No custom sub-agents yet")).toBeInTheDocument();
  });

  it("lists definitions with scope, state, and routing badges", () => {
    renderSection();
    const row = screen
      .getByText("Reviewer", { selector: '[data-part="title"]' })
      .closest("article");
    expect(row).not.toBeNull();
    const scoped = within(row as HTMLElement);
    expect(scoped.getByText("Reviews diffs")).toBeInTheDocument();
    expect(scoped.getByText("All projects")).toBeInTheDocument();
    expect(scoped.getByText("Manual only")).toBeInTheDocument();
    expect(
      row?.querySelector(".custom-agent-color-blue"),
    ).not.toBeNull();
    // Enabled definitions keep the disabled badge hidden.
    expect(scoped.queryByText("Disabled")).toBeNull();
  });

  it("creates a definition from the validated form", async () => {
    const user = userEvent.setup();
    const { api, applySettings, snapshot } = renderSection();
    await user.click(screen.getByRole("button", { name: "New sub-agent" }));

    // Opening the editor asks the main process for the effective-capability
    // preview with the widest mode.
    await waitFor(() =>
      expect(api.customAgentsPreviewCapabilities).toHaveBeenCalledWith(
        { toolPolicy: { kind: "inherit" } },
        "execute",
      ),
    );

    await user.type(screen.getByLabelText("Name"), "Docs writer");
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
    // Form closes after a successful save.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save sub-agent" }),
      ).toBeNull(),
    );
  });

  it("loads the full definition for editing and saves with its revision", async () => {
    const user = userEvent.setup();
    const { api } = renderSection();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() =>
      expect(api.customAgentsGet).toHaveBeenCalledWith("def-1"),
    );
    const instructions = await screen.findByLabelText(
      "Dedicated instructions",
    );
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

  it("keeps the form open and refreshes the snapshot on revision conflict", async () => {
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
    await screen.findByLabelText("Dedicated instructions");
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
