import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { nextAutomationOccurrence } from "../../../src/main/automation/automation-schedule.js";
import { store, settingsStore } from "../../../src/main/main.js";

import { smokeMode } from "./environment.js";

export const SMOKE_INPUT_FIELDS_AVATAR_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export async function seedSmokeInputFieldsFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // The smokeMode guard matches seedSmokeIconSizingFixture: seeding must
  // stay a smoke-harness-only behavior so a merely VIEW-tagged process can
  // never write smoke fixtures into a real profile.
  if (!store || !smokeMode || !view?.startsWith("input-fields-")) {
    return;
  }
  const fixtureDirectory = join(
    app.getPath("userData"),
    "fixtures",
    "input-fields",
  );
  await mkdir(fixtureDirectory, { recursive: true });
  // Synthetic avatar source for the Enter-activation chain (checklist §6-2):
  // a fixture-generated 1x1 PNG, never a real user photo.
  await writeFile(
    join(fixtureDirectory, "avatar.png"),
    SMOKE_INPUT_FIELDS_AVATAR_PNG_BASE64,
    "base64",
  );
  if (view !== "input-fields-automations-once") {
    return;
  }
  // The automation create button stays disabled without a project, so seed
  // one synthetic project whose path points inside the isolated user-data
  // tree (no real repository, no watcher, no network).
  const projectDirectory = join(fixtureDirectory, "project");
  await mkdir(projectDirectory, { recursive: true });
  const now = new Date().toISOString();
  store.upsertProject({
    id: "artemis-smoke-input-fields-project",
    name: "Artemis Smoke Input Fields",
    path: projectDirectory,
    createdAt: now,
    updatedAt: now,
  });
  // The editor requires an explicit available model. Keep this fixture local
  // and credential-free; its far-future automation is never dispatched.
  await settingsStore?.saveProviderConnection({
    id: "smoke-input-fields",
    name: "Synthetic input fields provider",
    baseUrl: "http://127.0.0.1:1/v1",
    models: [
      {
        id: "synthetic-model",
        name: "Synthetic Model",
        reasoning: false,
        input: ["text"],
        contextWindow: 128_000,
        maxTokens: 4096,
      },
    ],
  });
  await settingsStore?.setModel(
    {
      providerId: "smoke-input-fields",
      modelId: "synthetic-model",
      thinkingLevel: "off",
    },
    128_000,
  );
}

export async function seedSmokeSecondaryPagesFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!store || !smokeMode || !view?.startsWith("secondary-pages-")) {
    return;
  }
  if (view === "secondary-pages-token-usage") return;

  const fixtureDirectory = join(
    app.getPath("userData"),
    "fixtures",
    "secondary-pages",
  );
  await mkdir(fixtureDirectory, { recursive: true });
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-secondary-pages-project";
  store.upsertProject({
    id: projectId,
    name: "Artemis synthetic secondary-page project with a deliberately long name",
    path: fixtureDirectory,
    createdAt: now,
    updatedAt: now,
  });

  if (view === "secondary-pages-archive") {
    store.createThread({
      id: "artemis-smoke-secondary-pages-archived-thread",
      projectId,
      title:
        "Synthetic archived task with a deliberately long title for responsive layout evidence",
      mode: "plan",
      target: "local",
      status: "idle",
      pinned: false,
      archived: true,
      createdAt: now,
      updatedAt: now,
    });
    if (process.env.ARTEMIS_SMOKE_REVIEW06 === "1") {
      for (let index = 1; index <= 6; index++) {
        const date = new Date(
          Date.now() - index * 20 * 86_400_000,
        ).toISOString();
        store.createThread({
          id: `artemis-smoke-review06-archive-${index}`,
          projectId,
          title: `Archived review task ${index}`,
          mode: index % 2 ? "work" : "plan",
          target: "local",
          status: "idle",
          pinned: false,
          archived: true,
          createdAt: date,
          updatedAt: date,
        });
      }
    }
    return;
  }

  if (view === "secondary-pages-automations") {
    if (process.env.ARTEMIS_SMOKE_REVIEW06 === "1") {
      const schedule = {
        kind: "weekly" as const,
        daysOfWeek: [5],
        localTime: "09:00",
        timeZone: "Asia/Shanghai",
      };
      const nextRunAt = nextAutomationOccurrence(
        schedule,
        new Date(Date.now() + 86_400_000).toISOString(),
      );
      for (const [index, name] of [
        "01 每周研究简报",
        "02 依赖安全巡检",
        "03 评审项目变更",
      ].entries()) {
        const id = `artemis-smoke-review06-automation-${index}`;
        const createdAt = new Date(
          Date.now() - index * 86_400_000,
        ).toISOString();
        store.createAutomation({
          id,
          projectId,
          name,
          prompt: "Local UI fixture only. No model request is sent.",
          mode: "plan",
          target: "local",
          schedule,
          enabled: index !== 2,
          nextRunAt: index !== 2 ? nextRunAt : undefined,
          lastRunAt:
            index !== 2
              ? new Date(Date.now() - 7 * 86_400_000).toISOString()
              : undefined,
          authorizationState: "not-required",
          createdAt,
          updatedAt: createdAt,
        });
        if (index === 2) continue;
        const runStates =
          index === 0 ? ["completed", "completed", "failed"] : ["failed"];
        for (const [runIndex, state] of runStates.entries()) {
          const date = new Date(
            Date.now() - (runIndex + 1) * 7 * 86_400_000,
          ).toISOString();
          const threadId = `artemis-smoke-review06-automation-run-${index}-${runIndex}`;
          store.createThread({
            id: threadId,
            projectId,
            title: `${name} · local history fixture`,
            mode: "plan",
            target: "local",
            status: "idle",
            pinned: false,
            archived: false,
            createdAt: date,
            updatedAt: date,
          });
          store.claimAutomationRun(
            {
              id: threadId,
              automationId: id,
              threadId,
              scheduledFor: date,
              trigger: "schedule",
              state: state as "completed" | "failed",
              reason:
                state === "failed" ? "Synthetic local failure" : undefined,
              createdAt: date,
              updatedAt: date,
            },
            { advanceSchedule: false },
          );
        }
        store.updateAutomation({
          ...store.getAutomation(id)!,
          lastRunAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
          updatedAt: createdAt,
        });
      }
      return;
    }
    store.createAutomation({
      id: "artemis-smoke-secondary-pages-automation",
      projectId,
      name: "Synthetic automation with a deliberately long name for responsive layout evidence",
      prompt:
        "Synthetic smoke-only prompt used to verify that long automation content remains readable without changing scheduling behavior.",
      mode: "plan",
      target: "local",
      schedule: {
        kind: "weekly",
        daysOfWeek: [1, 3, 5],
        localTime: "09:30",
        timeZone: "UTC",
      },
      enabled: false,
      authorizationState: "not-required",
      createdAt: now,
      updatedAt: now,
    });
  }
}
