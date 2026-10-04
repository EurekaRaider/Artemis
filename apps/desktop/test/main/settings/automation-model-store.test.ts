import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Automation } from "@artemis/protocol";
import { AppStore } from "../../../src/main/settings/store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const automation: Automation = {
  id: "automation-1",
  projectId: "project-1",
  name: "Review",
  prompt: "Review the workspace.",
  mode: "plan",
  target: "local",
  enabled: true,
  authorizationState: "not-required",
  schedule: { kind: "interval", every: 2, unit: "hours" },
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "artemis-automation-model-"));
  directories.push(directory);
  const path = join(directory, "state.sqlite");
  const store = new AppStore(path);
  store.upsertProject({
    id: "project-1",
    name: "Sample",
    path: directory,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  });
  return { path, store };
}

describe("automation model persistence", () => {
  it("persists creation and edits independently of global defaults across reopening", async () => {
    const { path, store } = await fixture();
    const selection = {
      providerId: "sample",
      modelId: "reasoner",
      thinkingLevel: "high" as const,
    };
    store.createAutomation({ ...automation, modelSelection: selection });
    store.close();
    const reopened = new AppStore(path);
    expect(reopened.getAutomation(automation.id)?.modelSelection).toEqual(
      selection,
    );
    const changed = {
      ...selection,
      modelId: "fast",
      thinkingLevel: "off" as const,
    };
    reopened.updateAutomation({
      ...reopened.getAutomation(automation.id)!,
      modelSelection: changed,
    });
    reopened.close();
    const final = new AppStore(path);
    expect(final.listAutomations()[0]?.modelSelection).toEqual(changed);
    final.close();
  });

  it("adds the model column to an existing database without changing legacy records", async () => {
    const { path, store } = await fixture();
    store.createAutomation(automation);
    store.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("ALTER TABLE automations DROP COLUMN model_selection_json");
    legacy.close();
    const reopened = new AppStore(path);
    expect(reopened.getAutomation(automation.id)).toEqual(automation);
    reopened.close();
    const database = new DatabaseSync(path);
    expect(
      database
        .prepare("PRAGMA table_info(automations)")
        .all()
        .map((column) => column.name),
    ).toContain("model_selection_json");
    database.close();
  });
});
