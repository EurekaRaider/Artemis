import { readSharedApiSources, readPreloadBridgeSources } from '../fixtures/application/api-source.js';
import { readDesktopStyles } from "../fixtures/application/styles-source.js";
import { readRendererAppSources } from "../fixtures/application/renderer-source.js";
import { readMainProcessSources } from "../fixtures/application/main-source.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const main = readMainProcessSources();
const api = readSharedApiSources();
const preload = readPreloadBridgeSources();
const app = readRendererAppSources();
const styles = readDesktopStyles("styles");

describe("reported issues 66 and 67", () => {
  it("brokers explicit local paths only through an active Work or Codemode turn", () => {
    expect(main).toContain('case "local.file.read"');
    expect(main).toContain('case "local.file.write"');
    expect(main).toContain("!isExecutionMode(request.mode)");
    expect(main).toContain(
      "activeTurns.get(request.threadId) !== request.turnId",
    );
    expect(main).toContain('minimumRisk: "high" as const');
  });

  it("persists and renders project conversation drag ordering", () => {
    expect(api).toContain("setProjectThreadOrder(projectId: string");
    expect(preload).toContain("IPC.settingsProjectThreadOrderSet");
    expect(main).toContain("settingsStore.setProjectThreadOrder(");
    expect(app).toContain("orderProjectThreadsByPreference(");
    expect(app).toContain("reorderThreadIds(");
    expect(app).toContain("persistProjectThreadOrder(");
    expect(styles).toContain(".project-thread-row.drop-before::before");
    expect(styles).toContain(".project-thread-row.drop-after::after");
  });
});
