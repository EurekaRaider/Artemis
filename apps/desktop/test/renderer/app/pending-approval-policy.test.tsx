// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  type AgentEvent,
  type RunMode,
} from "@artemis/protocol";
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

const policies = [
  { policy: "ask", label: "Request approval", icon: "approval-ask" },
  { policy: "agent", label: "Approve for me", icon: "approval-agent" },
  { policy: "full-access", label: "Full access", icon: "approval-full" },
  { policy: "custom", label: "Custom", icon: "approval-ask" },
] as const;

it.each(
  (["plan", "work", "codemode"] as RunMode[]).flatMap((mode) =>
    policies.map((entry) => ({ mode, ...entry })),
  ),
)(
  "keeps $mode / $policy visible as read-only context while a decision is pending",
  async ({ mode, policy, label, icon }) => {
    vi.stubGlobal("requestIdleCallback", () => 0);
    vi.stubGlobal("cancelIdleCallback", () => {});
    localStorage.setItem(
      "artemis-sidebar-open",
      JSON.stringify({ protocolVersion: 1, value: true }),
    );
    const now = new Date().toISOString();
    const events: AgentEvent[] = [
      {
        protocolVersion: PROTOCOL_VERSION,
        eventId: "start",
        threadId: "thread",
        turnId: "turn",
        seq: 1,
        timestamp: now,
        payload: { type: "turn.started", mode },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        eventId: "question",
        threadId: "thread",
        turnId: "turn",
        seq: 2,
        timestamp: now,
        payload: {
          type: "user-input.requested",
          requestId: "question",
          nonce: "nonce-0000000001",
          header: "Question",
          question: "Which evidence should be recorded?",
          options: [
            {
              label: "Native capture",
              description: "Save the native screenshot",
              recommended: true,
            },
            {
              label: "Metrics",
              description: "Record dimensions",
              recommended: false,
            },
          ],
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      },
    ];
    const setApprovalPolicy = vi.fn();
    const pending = new Promise(() => {});
    const handlers: Record<string, unknown> = {
      getSnapshot: async () => ({
        projects: [
          {
            id: "project",
            name: "Fixture",
            path: "/fixture",
            createdAt: now,
            updatedAt: now,
          },
        ],
        threads: [
          {
            id: "thread",
            projectId: "project",
            title: "Pending decision",
            mode,
            target: "local",
            status: "running",
            pinned: false,
            archived: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        worktrees: [],
        events: { thread: events },
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
        theme: "light",
        approvalPolicy: policy,
        localFullAccess: false,
        fullAccessAvailable: true,
        shell: { windowsPreference: "auto", profileMode: "environment" },
        contextWindow: 128000,
        models: [],
        addedModels: [],
        credentials: [],
        providers: [],
        mcpServers: [],
        trustedExtensions: [],
        customAgents: [],
        globalAgents: { path: "/fixture", content: "" },
        update: {
          state: "idle",
          currentVersion: "1.0.0",
          rollbackAvailable: false,
        },
        agentConcurrency: { preference: { mode: "auto" }, configuredLimit: 8 },
      }),
      getThreadHistory: undefined,
      getThreadEvents: async () => events,
      listInstalledSkills: async () => [],
      listArtemisPlugins: async () => [],
      getProjectGitInfo: async () => ({ managed: false, branches: [] }),
      setApprovalPolicy,
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
    await screen.findAllByText("Pending decision");
    fireEvent.click(container.querySelector(".thread-title-copy")!);
    await screen.findByText("Which evidence should be recorded?");
    const status = await screen.findByRole("status", {
      name: "How should Artemis approve actions?",
    });
    expect(within(status).getByText(label)).toBeVisible();
    expect(status.querySelector("svg")).toHaveAttribute(
      "data-artemis-icon",
      icon,
    );
    expect(status.closest(".composer-context-surface")).not.toBeNull();
    expect(status.querySelector("button, input, a, [tabindex]")).toBeNull();
    expect(
      container.querySelector(".composer-run-modes [aria-checked=true]"),
    ).toHaveTextContent(
      mode === "plan" ? "Plan" : mode === "work" ? "Work" : "Code",
    );
    fireEvent.click(status);
    expect(setApprovalPolicy).not.toHaveBeenCalled();
    expect(container.querySelector(".approval-policy-menu")).toBeNull();
  },
);
