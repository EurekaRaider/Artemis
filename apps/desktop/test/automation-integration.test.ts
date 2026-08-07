import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const api = readFileSync(join(root, "src/shared/api.ts"), "utf8");
const preload = readFileSync(join(root, "src/preload/preload.ts"), "utf8");
const main = readFileSync(join(root, "src/main/main.ts"), "utf8");
const app = readFileSync(join(root, "src/renderer/App.tsx"), "utf8");
const page = readFileSync(
  join(root, "src/renderer/AutomationPage.tsx"),
  "utf8",
);
const styles = readFileSync(join(root, "src/renderer/styles.css"), "utf8");

describe("automation desktop integration", () => {
  it("exposes CRUD, run, authorization, and event APIs through isolated IPC", () => {
    for (const contract of [
      "listAutomations(",
      "saveAutomation(",
      "authorizeAutomation(",
      "runAutomationNow(",
      "onAutomationEvent(",
    ]) {
      expect(api).toContain(contract);
    }
    expect(preload).toContain("ipcRenderer.invoke(IPC.automationSave");
    expect(preload).toContain("ipcRenderer.on(IPC.automationEvent");
    expect(main).toContain("IPC.automationSave");
    expect(main).toContain("IPC.automationRunNow");
  });

  it("dispatches scheduled work through the same task and Pi turn entrypoints", () => {
    expect(main).toContain("async function createTaskThread(");
    expect(main).toContain("async function startTaskTurn(");
    expect(main).toMatch(
      /new AutomationScheduler\([\s\S]*?createTaskThread\([\s\S]*?startTaskTurn\(/u,
    );
    expect(main).toContain('type: "turn.prompt"');
  });

  it("requires a current fingerprint and audits automation approvals", () => {
    expect(main).toContain("automationAuthorizationFingerprint(automation)");
    expect(main).toContain("createAutomationApproval(request");
    expect(main).toContain('source: "automation"');
    expect(main).toContain("Trusted extension metadata no longer matches");
    expect(main).toContain("MCP tool metadata no longer matches");
  });

  it("adds a localized and accessible Automation activity", () => {
    expect(app).toContain('"workspace" | "archive" | "resources"');
    expect(app).toContain('"token-usage" | "automations"');
    expect(app).toContain('automations: "Automations"');
    expect(app).toContain('automations: "定时任务"');
    expect(app).toContain("<AutomationPage");
    expect(page).toContain('aria-modal="true"');
    expect(page).toContain('role="dialog"');
    expect(page).toContain("onAutomationEvent");
    expect(styles).toContain(".automation-page");
  });

  it("gives the header create action a decorative icon and interaction states", () => {
    const createButton =
      page.match(
        /<header className="automation-header">[\s\S]*?(<button[\s\S]*?\{t\.create\}[\s\S]*?<\/button>)[\s\S]*?<\/header>/u,
      )?.[1] ?? "";

    expect(createButton).toMatch(
      /<button(?=[^>]*\bclassName="[^"]*\bautomation-create-button\b[^"]*")[^>]*>/u,
    );
    expect(createButton).toMatch(
      /<svg(?=[^>]*\bclassName="automation-create-icon")(?=[^>]*\baria-hidden="true")[^>]*>[\s\S]*?<\/svg>/u,
    );
    expect(styles).toMatch(
      /\.automation-create-button:hover:not\(:disabled\)\s*\{\s*[^}]+\}/u,
    );
    expect(styles).toMatch(
      /\.automation-create-button:disabled\s*\{\s*[^}]+\}/u,
    );
  });
});
