import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import type { Automation, RunMode } from "@artemis/protocol";
import { AppStore } from "../../../src/main/settings/store.js";
import { automationAuthorizationFingerprint } from "../../../src/main/automation/automation-authorization.js";
it("migrates verified legacy grants and checkpoints but never revives an invalid grant", async () => {
  const dir = await mkdtemp(join(tmpdir(), "artemis-mode-migrate-"));
  const path = join(dir, "state.sqlite");
  let store = new AppStore(path);
  const now = new Date().toISOString();
  try {
    store.upsertProject({
      id: "p",
      name: "Project",
      path: dir,
      createdAt: now,
      updatedAt: now,
    });
    const template: Automation = {
      id: "valid",
      projectId: "p",
      name: "Daily",
      prompt: "Inspect",
      mode: "work",
      target: "local",
      schedule: { kind: "interval", every: 1, unit: "hours" },
      authorizationState: "authorized",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    store.createAutomation({
      ...template,
      authorizationFingerprint: automationAuthorizationFingerprint(template),
    });
    store.createAutomation({
      ...template,
      id: "invalid",
      authorizationFingerprint: "f".repeat(64),
    });
    store.createThread({
      id: "t",
      projectId: "p",
      title: "Legacy",
      mode: "work",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    store.saveTurnCheckpoint({
      threadId: "t",
      turnId: "interrupted",
      text: "Continue",
      source: "user",
      remote: false,
      mode: "work",
    });
    store.close();
    const database = new DatabaseSync(path);
    database.exec(
      "PRAGMA ignore_check_constraints=ON; PRAGMA user_version=13; UPDATE threads SET mode='review'; UPDATE automations SET mode='execute'; UPDATE turn_checkpoints SET body=json_set(body,'$.checkpoint.mode','execute');",
    );
    database
      .prepare(
        "UPDATE automations SET authorization_fingerprint=? WHERE id='valid'",
      )
      .run(
        automationAuthorizationFingerprint({
          ...template,
          mode: "execute" as RunMode,
        }),
      );
    database.close();
    store = new AppStore(path);
    expect(store.getThread("t")?.mode).toBe("plan");
    expect(store.getTurnCheckpoint("t")?.mode).toBe("work");
    expect(store.getAutomation("valid")).toMatchObject({
      mode: "work",
      enabled: true,
      authorizationState: "authorized",
      authorizationFingerprint: automationAuthorizationFingerprint(template),
    });
    expect(store.getAutomation("invalid")).toMatchObject({
      mode: "work",
      enabled: false,
      authorizationState: "required",
    });
    expect(
      store.getAutomation("invalid")?.authorizationFingerprint,
    ).toBeUndefined();
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
