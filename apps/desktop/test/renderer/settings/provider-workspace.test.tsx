// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { AgentModelInfo } from "@artemis/protocol";
import type { SettingsSnapshot } from "../../../src/shared/api.js";
import { SettingsPanel } from "../../../src/renderer/app/SettingsPanel.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
import "../../../src/renderer/app/i18n.js";
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
    ...overrides,
  } as unknown as SettingsSnapshot;
}

const syntheticModel: AgentModelInfo = {
  providerId: "synthetic-provider",
  modelId: "synthetic-model",
  name: "Synthetic Model",
  reasoning: false,
  contextWindow: 258_000,
  configured: true,
};

function stubSettingsApi(
  snapshot: SettingsSnapshot,
  overrides: Record<string, unknown> = {},
) {
  stubWindowArtemis({
    getSettings: () => Promise.resolve(snapshot),
    providerLoginOptions: () => Promise.resolve([]),
    onUpdateStatus: () => () => {},
    setProfileAvatar: () => Promise.resolve(snapshot),
    ...overrides,
  });
}

async function open(settings: SettingsSnapshot) {
  render(
    <SettingsPanel
      initialSettings={settings}
      initialTab="providers"
      locale="en"
      onClose={() => {}}
      onSettingsChange={() => {}}
    />,
  );
  await act(async () => {});
}

it("shows neutral credential metadata and keeps model editing independent of credentials", async () => {
  const settings = settingsSnapshot({
    models: [syntheticModel],
    credentials: [{ providerId: syntheticModel.providerId, type: "api_key" }],
    addedModels: [
      {
        providerId: syntheticModel.providerId,
        modelId: syntheticModel.modelId,
        contextWindow: 64000,
      },
    ],
  });
  stubSettingsApi(settings);
  await open(settings);
  expect(screen.getAllByText("API key configured")).toHaveLength(2);
  expect(screen.queryByText(/unauthorized|not authorized/i)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit: Synthetic Model" }),
  );
  const editor = screen.getByRole("form", { name: "Edit: Synthetic Model" });
  expect(within(editor).getByLabelText("Context length")).toHaveValue(64000);
  expect(within(editor).queryByLabelText(/API key/)).toBeNull();
});

it("switches providers without carrying a credential draft or showing another provider's models", async () => {
  const other = {
    ...syntheticModel,
    providerId: "other",
    modelId: "other-model",
    name: "Other model",
  };
  const settings = settingsSnapshot({
    models: [syntheticModel, other],
    addedModels: [syntheticModel, other],
  });
  const saveApiKey = vi.fn(async () => settings);
  stubSettingsApi(settings, { saveApiKey });
  await open(settings);
  await userEvent.type(
    screen.getByLabelText("API key · synthetic-provider"),
    "fixture-secret",
  );
  await userEvent.click(screen.getByRole("button", { name: /^other/ }));
  expect(screen.getByLabelText("API key · other")).toHaveValue("");
  expect(
    screen.queryByRole("button", { name: "Edit: Synthetic Model" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Edit: Other model" }),
  ).toBeVisible();
  expect(saveApiKey).not.toHaveBeenCalled();
});

it("keeps failed credential edits for retry and prevents concurrent model writes", async () => {
  const settings = settingsSnapshot({ models: [syntheticModel] });
  let reject!: (error: Error) => void;
  const saveApiKey = vi.fn(
    () =>
      new Promise<SettingsSnapshot>((_, fail) => {
        reject = fail;
      }),
  );
  stubSettingsApi(settings, { saveApiKey });
  await open(settings);
  fireEvent.click(screen.getByRole("button", { name: "Add model" }));
  await userEvent.type(
    screen.getByLabelText("API key · synthetic-provider"),
    "fixture-secret",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save API key" }));
  for (const button of screen.getAllByRole("button", { name: "Add model" }))
    expect(button).toBeDisabled();
  expect(
    screen.getByRole("button", { name: /^synthetic-provider/ }),
  ).toBeDisabled();
  await act(async () => reject(new Error("Storage unavailable")));
  expect(screen.getByText("Storage unavailable")).toBeVisible();
  expect(screen.getByLabelText("API key · synthetic-provider")).toHaveValue(
    "fixture-secret",
  );
  expect(screen.getByRole("button", { name: "Save API key" })).toBeEnabled();
});

it("offers only the selected provider's supported login routes and refreshes after immediate completion", async () => {
  const settings = settingsSnapshot({ models: [syntheticModel] });
  const refreshed = {
    ...settings,
    credentials: [
      { providerId: syntheticModel.providerId, type: "oauth" as const },
    ],
  };
  const start = vi.fn(async () => ({
    id: "login",
    providerId: syntheticModel.providerId,
    status: "completed",
    messages: [],
    links: [],
  }));
  const getSettings = vi
    .fn()
    .mockResolvedValueOnce(settings)
    .mockResolvedValue(refreshed);
  stubSettingsApi(settings, {
    getSettings,
    providerLoginOptions: async () => [
      {
        providerId: syntheticModel.providerId,
        name: "Synthetic login",
        type: "oauth",
      },
      { providerId: "other", name: "Other login", type: "oauth" },
    ],
    providerLoginStart: start,
    providerLoginCancel: vi.fn(async () => {}),
  });
  await open(settings);
  expect(screen.queryByLabelText("API key · synthetic-provider")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() =>
    expect(start).toHaveBeenCalledWith(syntheticModel.providerId, "oauth"),
  );
  await waitFor(() =>
    expect(screen.getAllByText("Signed in").length).toBeGreaterThan(1),
  );
});

it("requires confirmation before removing credentials and leaves them intact on cancel", async () => {
  const settings = settingsSnapshot({
    models: [syntheticModel],
    credentials: [{ providerId: syntheticModel.providerId, type: "api_key" }],
  });
  const deleteCredential = vi.fn(async () => ({
    ...settings,
    credentials: [],
  }));
  stubSettingsApi(settings, { deleteCredential });
  await open(settings);
  await userEvent.click(screen.getByRole("button", { name: "Remove API key" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  expect(deleteCredential).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Remove API key" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Delete",
    }),
  );
  await waitFor(() =>
    expect(deleteCredential).toHaveBeenCalledWith(syntheticModel.providerId),
  );
  expect(screen.getAllByText("Not configured")).toHaveLength(2);
});

it("keeps both credential-method tabs linked to mounted panels", async () => {
  const settings = settingsSnapshot({ models: [syntheticModel] });
  stubSettingsApi(settings, {
    providerLoginOptions: async () =>
      ["oauth", "api_key"].map((type) => ({
        providerId: syntheticModel.providerId,
        name: "Synthetic",
        type,
      })),
    providerLoginCancel: vi.fn(async () => {}),
  });
  await open(settings);
  const account = screen.getByRole("tab", { name: "Account sign-in" });
  await userEvent.click(account);
  for (const name of ["API key", "Account sign-in"]) {
    const tab = screen.getByRole("tab", { name });
    const panel = document.getElementById(tab.getAttribute("aria-controls")!);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    expect(panel!.hidden).toBe(name === "API key");
  }
});

it("fuzzy searches provider names and IDs without changing the selected provider or credential draft", async () => {
  const settings = settingsSnapshot({
    models: [syntheticModel, { ...syntheticModel, providerId: "deepseek" }],
    providers: [
      {
        id: "local-service",
        name: "本地测试接口",
        models: [],
        baseUrl: "https://example.invalid",
      },
    ],
  });
  stubSettingsApi(settings);
  await open(settings);
  const search = screen.getByRole("textbox", { name: "Search providers" });
  const navigation = document.querySelector(
    ".provider-navigation",
  )! as HTMLElement;
  await userEvent.type(
    screen.getByLabelText("API key · synthetic-provider"),
    "draft",
  );
  await userEvent.type(search, "D P S K");
  expect(within(navigation).getAllByRole("button")).toHaveLength(1);
  expect(
    within(navigation).getByRole("button", { name: /^deepseek/ }),
  ).toBeVisible();
  expect(screen.getByLabelText("API key · synthetic-provider")).toHaveValue(
    "draft",
  );
  await userEvent.clear(search);
  await userEvent.type(search, "本地接口");
  expect(
    within(navigation).getByRole("button", { name: /^本地测试接口/ }),
  ).toBeVisible();
  await userEvent.clear(search);
  await userEvent.type(search, "no-match-xyz");
  expect(within(navigation).getByRole("status")).toHaveTextContent(
    "No matching providers",
  );
  await userEvent.clear(search);
  expect(within(navigation).getAllByRole("button")).toHaveLength(3);
});
