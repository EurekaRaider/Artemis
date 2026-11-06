import { afterEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  store: {
    upsertProject: vi.fn(),
    createThread: vi.fn(),
    appendEvent: vi.fn(),
  },
}));
vi.mock("../../../src/main/main.js", () => ({
  store: f.store,
  activeTurns: new Map(),
  pendingMultiUserInputs: {},
  emitPayload: vi.fn(),
  handleUserInputBrokerRequest: vi.fn(),
  completeMultiUserInputQuestion: vi.fn(),
  settingsStore: undefined,
}));
vi.mock("electron", () => ({ app: { getPath: () => "/unused" } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("dedicated smoke fixtures", () => {
  it("does not seed a real profile from a bare view flag", async () => {
    vi.stubEnv("ARTEMIS_SMOKE_SCREENSHOT", "");
    vi.stubEnv("ARTEMIS_SMOKE_USER_INPUT", "");
    vi.stubEnv("ARTEMIS_SMOKE_MULTI_UI", "");
    vi.stubEnv("ARTEMIS_SMOKE_VIEW", "user-input-transport");
    const fixtures = await import("../../fixtures/smoke/user-input.js");
    fixtures.seedSmokeUserInputFixture();
    await fixtures.seedSmokeUserInputTransportFixture();
    vi.stubEnv("ARTEMIS_SMOKE_VIEW", "multi-question-ui");
    await fixtures.seedSmokeMultiQuestionUiFixture();
    expect(f.store.upsertProject).not.toHaveBeenCalled();
    expect(f.store.createThread).not.toHaveBeenCalled();
    expect(f.store.appendEvent).not.toHaveBeenCalled();
  });
  it.each([
    ["en", "Confirm the plan"],
    ["zh-CN", "确认实施计划"],
  ])(
    "keeps the existing %s user-input fixture identities and prompt",
    async (locale, title) => {
      vi.stubEnv("ARTEMIS_SMOKE_USER_INPUT", "1");
      vi.stubEnv("ARTEMIS_SMOKE_LOCALE", locale);
      const { seedSmokeUserInputFixture } =
        await import("../../fixtures/smoke/user-input.js");
      seedSmokeUserInputFixture();
      expect(f.store.upsertProject).toHaveBeenCalledOnce();
      expect(f.store.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "artemis-smoke-user-input",
          projectId: "artemis-smoke-project",
          title,
          mode: "work",
          target: "local",
        }),
      );
      expect(f.store.appendEvent).toHaveBeenCalledWith(
        "artemis-smoke-user-input-event",
        "artemis-smoke-user-input",
        "smoke-turn",
        expect.objectContaining({
          type: "user-input.requested",
          requestId: "artemis-smoke-request",
          nonce: "artemis-smoke-nonce-0001",
        }),
      );
    },
  );
});
