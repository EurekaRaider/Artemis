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
import { ProviderWorkspace } from "../../../src/renderer/settings/ProviderWorkspace.js";
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
  expect(screen.getAllByText("Connected")).toHaveLength(2);
  expect(screen.getByLabelText("API key · synthetic-provider")).toHaveAttribute(
    "placeholder",
    "••••••••••••",
  );
  expect(screen.queryByRole("button", { name: "Update API key" })).toBeNull();
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
  fireEvent.click(screen.getByRole("menuitem", { name: "From catalog" }));
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
  await waitFor(() => expect(screen.getByText("Signed in")).toBeVisible());
});

it("requires confirmation before removing credentials and leaves them intact on cancel", async () => {
  const settings = settingsSnapshot({
    models: [syntheticModel],
    credentials: [{ providerId: syntheticModel.providerId, type: "api_key" }],
  });
  const deleteCredential = vi.fn(async () => ({
    ...settings,
    credentials: [],
    models: [{ ...syntheticModel, configured: false }],
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
  expect(screen.getByText("Not connected")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Remove API key" })).toBeNull();
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
    models: [
      syntheticModel,
      { ...syntheticModel, providerId: "deepseek" },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...syntheticModel,
        providerId: `extra-${index}`,
      })),
    ],
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
  const search = screen.getByRole("searchbox", { name: "Search providers" });
  const navigation = document.querySelector(
    ".provider-navigation",
  )! as HTMLElement;
  await userEvent.type(
    screen.getByLabelText("API key · synthetic-provider"),
    "draft",
  );
  await userEvent.type(search, "D P S K");
  expect(navigation.querySelectorAll(".provider-navigation-item")).toHaveLength(
    1,
  );
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
  expect(navigation.querySelectorAll(".provider-navigation-item")).toHaveLength(
    9,
  );
});

it("shows all remaining providers when removing a ninth service hides an active search", async () => {
  const settings = settingsSnapshot({
    models: [
      syntheticModel,
      ...Array.from({ length: 8 }, (_, index) => ({
        ...syntheticModel,
        providerId: `extra-${index}`,
      })),
    ],
  });
  stubSettingsApi(settings);
  const onSelect = vi.fn();
  const workspace = (snapshot: SettingsSnapshot) => (
    <ProviderWorkspace
      settings={snapshot}
      locale="en"
      selectedProviderId={syntheticModel.providerId}
      disabled={false}
      creating={false}
      onBusy={() => {}}
      onSelect={onSelect}
      onAdd={() => {}}
      onChange={() => {}}
      onDeleteConnection={() => {}}
    >
      {null}
    </ProviderWorkspace>
  );
  const { rerender } = render(workspace(settings));
  await userEvent.type(
    screen.getByRole("searchbox", { name: "Search providers" }),
    "extra-7",
  );
  const navigation = document.querySelector<HTMLElement>(
    ".provider-navigation",
  )!;
  expect(navigation.querySelectorAll(".provider-navigation-item")).toHaveLength(
    1,
  );
  expect(
    within(navigation).getByRole("button", { name: /^extra-7/ }),
  ).toBeVisible();

  const remainingModels = settings.models.slice(0, -1);
  rerender(workspace({ ...settings, models: remainingModels }));

  expect(
    screen.queryByRole("searchbox", { name: "Search providers" }),
  ).toBeNull();
  expect(
    [...navigation.querySelectorAll(".provider-navigation-name")].map(
      (element) => element.textContent,
    ),
  ).toEqual(remainingModels.map((model) => model.providerId).sort());
  expect(within(navigation).queryByRole("status")).toBeNull();
  expect(
    within(navigation).getByRole("button", {
      name: /^synthetic-provider/,
    }),
  ).toHaveAttribute("data-state", "selected");
  expect(onSelect).not.toHaveBeenCalled();
});

it("saves new-task model defaults without changing credentials and constrains effort to the selected model", async () => {
  const reasoning = {
    ...syntheticModel,
    modelId: "reasoner",
    name: "Reasoner",
    reasoning: true,
    thinkingLevels: ["low", "high"] as const,
  };
  const settings = settingsSnapshot({
    models: [syntheticModel, reasoning],
    addedModels: [syntheticModel, reasoning],
    selection: {
      providerId: syntheticModel.providerId,
      modelId: syntheticModel.modelId,
      thinkingLevel: "off",
    },
  });
  const save = vi.fn(async (selection) => ({ ...settings, selection }));
  const saveKey = vi.fn();
  stubSettingsApi(settings, { setModelSelection: save, saveApiKey: saveKey });
  await open(settings);
  expect(
    screen.getByRole("img", { name: "Default model: Synthetic Model" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("img", { name: "Default model: Reasoner" }),
  ).toBeNull();
  await userEvent.click(screen.getByLabelText("Default model"));
  await userEvent.click(screen.getByRole("option", { name: /Reasoner/ }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      providerId: syntheticModel.providerId,
      modelId: "reasoner",
      thinkingLevel: "high",
    }),
  );
  expect(
    screen.getByRole("img", { name: "Default model: Reasoner" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("img", { name: "Default model: Synthetic Model" }),
  ).toBeNull();
  const effort = screen.getByRole("group", { name: "Thinking intensity" });
  expect(within(effort).getAllByRole("button")).toHaveLength(3);
  await userEvent.click(within(effort).getByRole("button", { name: "Low" }));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith({
      providerId: syntheticModel.providerId,
      modelId: "reasoner",
      thinkingLevel: "low",
      ultraMode: false,
    }),
  );
  expect(saveKey).not.toHaveBeenCalled();
});

it("keeps the full catalog in the add-service picker and adds only the chosen draft", async () => {
  const settings = settingsSnapshot({
    models: [
      syntheticModel,
      { ...syntheticModel, providerId: "unconfigured", configured: false },
    ],
  });
  stubSettingsApi(settings);
  await open(settings);
  const sidebar = document.querySelector(".provider-sidebar")! as HTMLElement;
  expect(sidebar.querySelectorAll(".provider-navigation-item")).toHaveLength(1);
  expect(within(sidebar).queryByRole("textbox")).toBeNull();
  expect(
    within(sidebar).queryByRole("button", { name: /^unconfigured/ }),
  ).toBeNull();
  await userEvent.click(
    within(sidebar).getByRole("button", { name: "Add provider" }),
  );
  const picker = screen.getByRole("dialog", { name: "Add provider" });
  await userEvent.type(
    within(picker).getByLabelText("Search providers"),
    "unconfigured",
  );
  await userEvent.click(
    within(picker).getByRole("button", { name: "unconfigured" }),
  );
  expect(screen.queryByRole("dialog", { name: "Add provider" })).toBeNull();
  expect(
    within(sidebar).getByRole("button", { name: "unconfigured" }),
  ).toHaveAttribute("data-state", "selected");
  expect(screen.getByLabelText("API key · unconfigured")).toHaveValue("");
});

async function openCustomProvider(settings: SettingsSnapshot) {
  await open(settings);
  await userEvent.click(
    within(
      document.querySelector(".provider-sidebar")! as HTMLElement,
    ).getByRole("button", { name: "Add provider" }),
  );
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Add provider" })).getByRole(
      "button",
      { name: "Custom service…" },
    ),
  );
}

it("preserves model capabilities and advanced parameters when their disclosures are collapsed before saving", async () => {
  const settings = settingsSnapshot();
  const save = vi.fn(async () => settings);
  stubSettingsApi(settings, { saveProviderConnection: save });
  await openCustomProvider(settings);
  expect(screen.getByRole("button", { name: "Add provider" })).toHaveAttribute(
    "data-state",
    "selected",
  );

  const capabilities = screen
    .getByText("Model capabilities & limits")
    .closest("details")!;
  const advanced = screen.getByText("Advanced parameters").closest("details")!;
  expect(capabilities).not.toHaveAttribute("open");
  expect(advanced).not.toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "Save provider" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Service name"), "Local service");
  await userEvent.type(screen.getByLabelText("Provider ID"), "local-service");
  await userEvent.type(
    screen.getByLabelText("Base URL"),
    "http://127.0.0.1:11434/v1",
  );
  await userEvent.type(screen.getByLabelText("Model ID"), "local-model");

  await userEvent.click(
    within(capabilities).getByText("Model capabilities & limits"),
  );
  await userEvent.clear(screen.getByLabelText("Context length"));
  await userEvent.type(screen.getByLabelText("Context length"), "262144");
  await userEvent.clear(screen.getByLabelText("Max output tokens"));
  await userEvent.type(screen.getByLabelText("Max output tokens"), "8192");
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Supports reasoning" }),
  );
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Supports image input" }),
  );
  expect(
    screen.getByRole("button", { name: /Highest supported reasoning level/ }),
  ).toBeVisible();
  await userEvent.click(
    within(capabilities).getByText("Model capabilities & limits"),
  );
  expect(capabilities).not.toHaveAttribute("open");
  expect(capabilities.querySelector("summary")).toHaveTextContent(
    "Context 262.1K · Output 8.2K · Supports reasoning · Supports image input",
  );

  await userEvent.click(within(advanced).getByText("Advanced parameters"));
  await userEvent.clear(
    screen.getByLabelText("Advanced model parameters (JSON)"),
  );
  fireEvent.change(screen.getByLabelText("Advanced model parameters (JSON)"), {
    target: { value: '{"samplingParams":{"temperature":0.4}}' },
  });
  await userEvent.click(within(advanced).getByText("Advanced parameters"));
  await userEvent.click(screen.getByRole("button", { name: "Save provider" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(
    {
      id: "local-service",
      name: "Local service",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      models: [
        {
          id: "local-model",
          name: "local-model",
          reasoning: true,
          highestThinkingLevel: "high",
          input: ["text", "image"],
          contextWindow: 262144,
          maxTokens: 8192,
          samplingParams: { temperature: 0.4 },
        },
      ],
    },
    undefined,
  );
});

it("reopens invalid advanced JSON without calling the save API", async () => {
  const settings = settingsSnapshot();
  const save = vi.fn(async () => settings);
  stubSettingsApi(settings, { saveProviderConnection: save });
  await openCustomProvider(settings);
  await userEvent.type(screen.getByLabelText("Provider ID"), "local");
  await userEvent.type(
    screen.getByLabelText("Base URL"),
    "http://127.0.0.1:11434/v1",
  );
  await userEvent.type(screen.getByLabelText("Model ID"), "model");
  const advanced = screen.getByText("Advanced parameters").closest("details")!;
  await userEvent.click(within(advanced).getByText("Advanced parameters"));
  fireEvent.change(screen.getByLabelText("Advanced model parameters (JSON)"), {
    target: { value: "{invalid" },
  });
  await userEvent.click(within(advanced).getByText("Advanced parameters"));
  await userEvent.click(screen.getByRole("button", { name: "Save provider" }));
  await waitFor(() => expect(advanced).toHaveAttribute("open"));
  expect(
    screen.getByLabelText("Advanced model parameters (JSON)"),
  ).toBeVisible();
  expect(
    screen.getByLabelText("Advanced model parameters (JSON)"),
  ).toHaveFocus();
  expect(save).not.toHaveBeenCalled();
});

it("saves an inline Base URL edit without changing the service's other settings", async () => {
  const provider = {
    id: syntheticModel.providerId,
    name: "Local service",
    baseUrl: "https://old.example.invalid/v1",
    api: "openai-completions",
    models: [],
  };
  const settings = settingsSnapshot({
    models: [syntheticModel],
    providers: [provider],
  });
  const save = vi.fn(async (connection) => ({
    ...settings,
    providers: [connection],
  }));
  stubSettingsApi(settings, { saveProviderConnection: save });
  await open(settings);
  const input = screen.getByLabelText("Base URL");
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  await userEvent.clear(input);
  await userEvent.type(input, "https://new.example.invalid/v1");
  expect(save).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({
      ...provider,
      baseUrl: "https://new.example.invalid/v1",
    }),
  );
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

it("distinguishes duplicate model names while keeping unique default-model labels short", async () => {
  const duplicate = {
    ...syntheticModel,
    providerId: "second-service",
    modelId: "second-model",
  };
  const fullWidth = {
    ...syntheticModel,
    providerId: "full-width-service",
    modelId: "full-width-model",
    name: "Ｓｙｎｔｈｅｔｉｃ　Ｍｏｄｅｌ",
  };
  const repeatedSpaces = {
    ...syntheticModel,
    providerId: "spaced-service",
    modelId: "spaced-model",
    name: "Synthetic   Model",
  };
  const unique = { ...syntheticModel, modelId: "unique", name: "Unique" };
  const settings = settingsSnapshot({
    models: [syntheticModel, duplicate, fullWidth, repeatedSpaces, unique],
    addedModels: [syntheticModel, duplicate, fullWidth, repeatedSpaces, unique],
  });
  stubSettingsApi(settings);
  await open(settings);
  await userEvent.click(screen.getByLabelText("Default model"));
  expect(
    screen.getByRole("option", { name: "Unique", exact: true }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", {
      name: "Synthetic Model · synthetic-provider/synthetic-model",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", {
      name: "Synthetic Model · second-service/second-model",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", {
      name: "Ｓｙｎｔｈｅｔｉｃ　Ｍｏｄｅｌ · full-width-service/full-width-model",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", {
      name: "Synthetic Model · spaced-service/spaced-model",
      exact: true,
    }),
  ).toBeVisible();
});

it("searches settings navigation without unmounting the active provider or exposing a credential draft", async () => {
  const settings = settingsSnapshot({ models: [syntheticModel] });
  stubSettingsApi(settings);
  await open(settings);
  await userEvent.type(
    screen.getByLabelText("Search settings"),
    "zz-no-section",
  );
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Model services",
  ]);
  expect(
    screen.getByRole("tabpanel", { name: "Model services" }),
  ).toBeVisible();
  await userEvent.clear(screen.getByLabelText("Search settings"));
  expect(screen.getAllByRole("tab")).toHaveLength(7);
});
