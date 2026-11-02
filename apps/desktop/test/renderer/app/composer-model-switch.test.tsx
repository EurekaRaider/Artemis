// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../../src/renderer/app/App.js";
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
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each(["model", "thinking"])(
  "keeps the empty conversation and draft mounted while saving %s selection",
  async (kind) => {
    vi.stubGlobal("requestIdleCallback", () => 0);
    vi.stubGlobal("cancelIdleCallback", () => {});
    const now = new Date().toISOString();
    const selection = {
      providerId: "fixture",
      modelId: "one",
      thinkingLevel: "high",
    };
    const thread = {
      id: "thread",
      title: "Empty draft",
      mode: "work",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      modelSelection: selection,
    };
    const model = {
      providerId: "fixture",
      modelId: "one",
      name: "First model",
      configured: true,
      reasoning: true,
      thinkingLevels: ["low", "high"],
      contextWindow: 128000,
    };
    let finish!: (value: unknown) => void;
    const save = vi.fn(
      (_threadId: string, _selection: unknown) =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = new Promise(() => {});
    const handlers: Record<string, unknown> = {
      getSnapshot: async () => ({
        projects: [],
        threads: [thread],
        worktrees: [],
        events: { thread: [] },
        locale: "en",
        platform: "darwin",
        userName: "QA",
        sandbox: { available: true },
      }),
      getSettings: async () => ({
        platform: "darwin",
        encryptionAvailable: true,
        language: "en",
        resolvedLocale: "en",
        theme: "dark",
        approvalPolicy: "agent",
        localFullAccess: false,
        fullAccessAvailable: true,
        shell: { windowsPreference: "auto", profileMode: "environment" },
        selection,
        contextWindow: 128000,
        models: [model, { ...model, modelId: "two", name: "Second model" }],
        addedModels: [selection, { providerId: "fixture", modelId: "two" }],
        credentials: [],
        providers: [],
        mcpServers: [],
        trustedExtensions: [],
        customAgents: [],
        globalAgents: { path: "/fixture", content: "" },
        update: {
          state: "idle",
          currentVersion: "2.0.1",
          rollbackAvailable: false,
        },
        agentConcurrency: { preference: { mode: "auto" }, configuredLimit: 8 },
      }),
      getThreadHistory: undefined,
      getThreadEvents: async () => [],
      listInstalledSkills: async () => [],
      listArtemisPlugins: async () => [],
      setThreadModelSelection: save,
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
    await screen.findAllByText("Empty draft");
    fireEvent.click(container.querySelector(".thread-title-copy")!);
    await waitFor(() =>
      expect(container.querySelector(".conversation")).toHaveAttribute(
        "data-state",
        "empty",
      ),
    );
    const draft =
      container.querySelector<HTMLTextAreaElement>(".composer textarea")!;
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    fireEvent.click(container.querySelector(".model-button")!);
    if (kind === "model")
      fireEvent.click(screen.getByRole("option", { name: /Second model/ }));
    else fireEvent.click(screen.getByRole("button", { name: "Low" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(container.querySelector(".conversation")).toHaveAttribute(
      "data-state",
      "empty",
    );
    expect(container.querySelector(".composer textarea")).toBe(draft);
    expect(draft).toHaveValue("Keep this draft");
    if (kind === "thinking") expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () =>
      finish({ ...thread, modelSelection: save.mock.calls[0]![1] }),
    );
    expect(container.querySelector(".conversation")).toHaveAttribute(
      "data-state",
      "empty",
    );
    expect(draft).toHaveValue("Keep this draft");
  },
  // Match the full-shell acceptance budget on slower hosted runners.
  15_000,
);
