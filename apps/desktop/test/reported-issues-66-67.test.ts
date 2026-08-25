import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const main = readFileSync(join(root, "src/main/main.ts"), "utf8");
const api = readFileSync(join(root, "src/shared/api.ts"), "utf8");
const preload = readFileSync(join(root, "src/preload/preload.ts"), "utf8");
const app = readFileSync(join(root, "src/renderer/App.tsx"), "utf8");
const styles = readFileSync(join(root, "src/renderer/styles.css"), "utf8");

describe("reported issues 66 and 67", () => {
  it("brokers explicit local paths only through an active Execute turn", () => {
    expect(main).toContain('case "local.file.read"');
    expect(main).toContain('case "local.file.write"');
    expect(main).toContain('request.mode !== "execute"');
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
