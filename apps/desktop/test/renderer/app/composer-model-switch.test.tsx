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

it.each(
  ["model", "thinking"].flatMap((kind) =>
    [false, true].flatMap((newConversation) =>
      [false, true].map((saveFails) => ({ kind, newConversation, saveFails })),
    ),
  ),
)(
  "keeps the composer stable and picker open for $kind (new=$newConversation, failure=$saveFails)",
  async ({ kind, newConversation, saveFails }) => {
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
    let fail!: (reason: Error) => void;
    const save = vi.fn(
      (_threadId: string, _selection: unknown) =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const startTurn = vi.fn();
    let created = !newConversation;
    const pending = new Promise(() => {});
    const handlers: Record<string, unknown> = {
      getSnapshot: async () => ({
        projects: [],
        threads: created ? [thread] : [],
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
      createThread: async () => {
        created = true;
        return thread;
      },
      startTurn,
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
    if (!newConversation) {
      await screen.findAllByText("Empty draft");
      fireEvent.click(container.querySelector(".thread-title-copy")!);
    }
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
    const menu = screen.getByRole("dialog");
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
    expect(screen.getByRole("dialog")).toBe(menu);
    expect(menu).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".model-button")).toBeEnabled();
    expect(container.querySelector(".approval-policy-trigger")).toBeEnabled();
    for (const control of container.querySelectorAll(
      ".composer-run-modes button, .thinking-level-control button",
    )) {
      expect(control).toBeEnabled();
    }
    expect(
      screen.getByRole("button", {
        name: kind === "thinking" ? "Low" : "High",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".send-button")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(
      container.querySelector(".thinking-level-control button:last-child")!,
    );
    fireEvent.click(screen.getByRole("option", { name: /Second model/ }));
    fireEvent.click(container.querySelector(".send-button")!);
    fireEvent.keyDown(draft, { key: "Enter" });
    expect(save).toHaveBeenCalledOnce();
    expect(startTurn).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBe(menu);
    await act(async () => {
      if (saveFails) fail(new Error("Fixture save failed"));
      else finish({ ...thread, modelSelection: save.mock.calls[0]![1] });
    });
    expect(container.querySelector(".conversation")).toHaveAttribute(
      "data-state",
      "empty",
    );
    expect(draft).toHaveValue("Keep this draft");
    expect(screen.getByRole("dialog")).toBe(menu);
    expect(menu).not.toHaveAttribute("aria-busy");
    expect(container.querySelector(".send-button")).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(screen.getByRole("option", { name: /First model/ })).toHaveAttribute(
      "aria-selected",
      String(saveFails || kind === "thinking"),
    );
    expect(
      screen.getByRole("button", {
        name: kind === "thinking" && !saveFails ? "Low" : "High",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    if (saveFails)
      expect(screen.getByText(/Fixture save failed/)).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(container.querySelector(".model-button")!);
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.click(container.querySelector(".model-button")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
  // Match the full-shell acceptance budget on slower hosted runners.
  15_000,
);
