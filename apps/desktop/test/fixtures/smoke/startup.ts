import { parseMaterialPreference } from "../../../src/shared/window-material.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { store, settingsStore } from "../../../src/main/main.js";
import {
  seedSmokeUserInputFixture,
  seedSmokeUserInputTransportFixture,
} from "./user-input.js";
import {
  seedSmokeTokenUsageFixture,
  seedSmokeGoalFixture,
  seedSmokeTurnChangesFixture,
  seedSmokeConversationTimelineFixture,
  seedSmokeMessageActionsFixture,
  seedSmokeQueuedSteerFixture,
} from "./conversation.js";
import {
  seedSmokeMarkdownEditorFixture,
  seedSmokeEnvironmentFixture,
} from "./workspace.js";
import {
  seedSmokeMcpEditorFixture,
  seedSmokeIconSizingFixture,
} from "./resources.js";
import {
  seedSmokeInputFieldsFixture,
  seedSmokeSecondaryPagesFixture,
} from "./settings.js";
import { smokeMode } from "./environment.js";

export async function configureSmokeSettings() {
  if (!settingsStore) throw new Error("Settings are not ready");
  if (
    smokeMode &&
    (process.env.ARTEMIS_SMOKE_VIEW === "nocturne-settings-providers" ||
      process.env.ARTEMIS_SMOKE_REVIEW06 === "1")
  ) {
    // An isolated local definition exercises model rows and the saved default
    // without importing credentials or claiming a successful connection.
    const providerId = "nocturne-local-fixture";
    const modelId = "fixture-model";
    const contextWindow = 64_000;
    await settingsStore.saveProviderConnection({
      id: providerId,
      name: "Local UI fixture",
      baseUrl: "http://127.0.0.1:65535/v1",
      models: [
        {
          id: modelId,
          name: "Fixture model",
          reasoning: true,
          input: ["text"],
          contextWindow,
          maxTokens: 8_000,
        },
      ],
    });
    await settingsStore.addModel({ providerId, modelId, contextWindow });
    await settingsStore.setModel(
      { providerId, modelId, thinkingLevel: "medium" },
      contextWindow,
    );
    if (process.env.ARTEMIS_SMOKE_REVIEW06 === "1") {
      for (const [id, name, reasoning] of [
        ["review06-reasoning", "Reasoning fixture", true],
        ["review06-text", "Text fixture", false],
        ["review06-fast", "Fast fixture", true],
      ] as const) {
        await settingsStore.saveProviderConnection({
          id,
          name: id === "review06-fast" ? "Second fixture provider" : name,
          baseUrl: "http://127.0.0.1:65535/v1",
          models: [
            {
              id,
              name,
              reasoning,
              input: ["text"],
              contextWindow: 200_000,
              maxTokens: 8_000,
            },
          ],
        });
        await settingsStore.addModel({
          providerId: id,
          modelId: id,
          contextWindow: 200_000,
        });
      }
    }
  }
  if (smokeMode && process.env.ARTEMIS_SMOKE_MATERIAL) {
    await settingsStore.setMaterialPreference(
      parseMaterialPreference(process.env.ARTEMIS_SMOKE_MATERIAL),
    );
  }
  const smokeTheme = process.env.ARTEMIS_SMOKE_THEME;
  if (
    smokeMode &&
    (smokeTheme === "system" || smokeTheme === "light" || smokeTheme === "dark")
  ) {
    await settingsStore.setThemePreference(smokeTheme);
  }
}

export async function seedSmokeWorkspace() {
  await seedSmokeEnvironmentFixture();
  seedSmokeUserInputFixture();
  await seedSmokeUserInputTransportFixture();
  seedSmokeTokenUsageFixture();
  seedSmokeGoalFixture();
  seedSmokeTurnChangesFixture();
  await seedSmokeConversationTimelineFixture();
  seedSmokeMessageActionsFixture();
  seedSmokeQueuedSteerFixture();
  seedSmokeMarkdownEditorFixture();
}

export async function seedSmokeResources() {
  if (!store) throw new Error("Store is not ready");
  await seedSmokeMcpEditorFixture();
  await seedSmokeIconSizingFixture();
  await seedSmokeInputFieldsFixture();
  await seedSmokeSecondaryPagesFixture();
  if (smokeMode && process.env.ARTEMIS_SMOKE_REVIEW06 === "1") {
    const emptyProjectPath = join(
      app.getPath("userData"),
      "fixtures",
      "review06-empty-project",
    );
    await mkdir(emptyProjectPath, { recursive: true });
    store.upsertProject({
      id: "artemis-smoke-review06-empty-project",
      name: "Empty project",
      path: emptyProjectPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (process.env.ARTEMIS_SMOKE_REVIEW06_STATE === "thread") {
      const now = new Date().toISOString();
      store.createThread({
        id: "e59ea82c-775a-4a3f-87ab-62c11ac31f3b",
        projectId: "artemis-smoke-review06-empty-project",
        title: "Local task link fixture",
        mode: "plan",
        target: "local",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const [name, description] of [
      ["研究智能体", "检索、对比与引用核对"],
      ["评审智能体", "代码评审与测试补全"],
    ]) {
      store.createCustomAgent({
        name: name!,
        description: description!,
        color: "gray",
        enabled: true,
        instructions: "Synthetic local UI fixture. Never execute.",
        scope: "all",
        projectIds: [],
        modelPolicy: { kind: "inherit" },
        thinkingPolicy: { kind: "inherit" },
        toolPolicy: { kind: "inherit" },
        allowAutomaticInvocation: false,
        triggers: [],
      });
    }
  }
}
