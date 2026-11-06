import { readSharedApiSources, readPreloadBridgeSources } from '../../fixtures/application/api-source.js';
import { readDesktopStyles } from "../../fixtures/application/styles-source.js";
import { readRendererAppSources } from "../../fixtures/application/renderer-source.js";
import { readMainProcessSources } from "../../fixtures/application/main-source.js";
import { uiText } from "../../../src/shared/i18n/ui-text.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { findCssDeclarations } from "../../contracts/css-test-utils.js";

const root = join(import.meta.dirname, "../../..");
const api = readSharedApiSources();
const preload = readPreloadBridgeSources();
const main = readMainProcessSources();
const app = readRendererAppSources();
const page = readFileSync(
  join(root, "src/renderer/automation/AutomationPage.tsx"),
  "utf8",
);
const styles = readDesktopStyles("styles");
const publicStyles = readFileSync(
  join(root, "../../packages/ui/src/styles.css"),
  "utf8",
);
const publicFeedback = readFileSync(
  join(root, "../../packages/ui/src/feedback.tsx"),
  "utf8",
);

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

  it("removes a completed one-time automation without archiving its task", () => {
    expect(main).toContain("store.completeAutomationRunForThread(threadId)");
    expect(main).toContain("automationDeleted(completion.deletedAutomationId)");
  });

  it("adds a localized and accessible Automation activity", () => {
    expect(app).toContain('"workspace" | "archive" | "resources"');
    expect(app).toContain('"token-usage" | "automations"');
    expect(uiText("en", "App_copy.automations")).toBe("Automations");
    expect(uiText("zh-CN", "App_copy.automations")).toBe("定时任务");
    expect(app).toContain("<AutomationPage");
    expect(page).toContain("<Dialog");
    expect(page).toContain('className="automation-dialog-shell"');
    expect(publicFeedback).toContain('aria-modal="true"');
    expect(publicFeedback).toContain("role={role}");
    expect(page).toContain("onAutomationEvent");
    expect(styles).toContain(".automation-page");
  });

  it("edits persisted interval schedules with value and unit controls", () => {
    expect(page).toMatch(
      /type SchedulePreset =\s*"once" \| "interval" \| "windowed-interval"/u,
    );
    expect(page).toContain('kind: "interval"');
    expect(page).toContain('kind: "windowed-interval"');
    expect(page).toContain('draft.preset === "interval"');
    expect(page).toContain('draft.preset === "windowed-interval"');
    expect(page).toContain('className="automation-interval-field"');
    expect(page).toContain("intervalEvery");
    expect(page).toContain("intervalUnit");
  });

  it("gives the primary header create action a decorative icon and interaction states", () => {
    expect(page).toContain("<ManagementHeader");
    expect(page).toContain('className="automation-create-button"');
    expect(page).toContain('className="automation-create-icon"');
    expect(page).toContain('variant="primary"');
    expect(page).toContain("<Button");
    expect(publicStyles).toMatch(
      /\[data-artemis-component="button"\]\[data-variant="primary"\]:hover:not\(\s*:disabled\s*\)/u,
    );
    expect(styles).toMatch(
      /\.automation-create-button:disabled\s*\{\s*[^}]+\}/u,
    );
  });

  it("uses a styled, accessible time picker instead of Chromium's native popup", () => {
    expect(page).not.toContain('type="time"');
    expect(page).toContain("function TimePicker(");
    expect(page).toContain('aria-haspopup="dialog"');
    expect(page).toContain('className="automation-time-popover"');
    expect(page).toContain('role="listbox"');
    expect(page).toContain('role="option"');
    expect(page).toContain("aria-selected={option === props.value}");
    expect(styles).toContain(".automation-time-trigger");
    expect(styles).toContain(".automation-time-popover");
    expect(
      findCssDeclarations(styles, ".automation-time-option:focus-visible"),
    ).toContain("outline:");
  });

  it("renders the time picker popover on an opaque theme surface", () => {
    expect(styles).toMatch(
      /\.automation-time-popover\s*\{[^}]*background: var\(--panel-2\)/su,
    );
    expect(styles).toMatch(
      /\.automation-time-popover::after\s*\{[^}]*background: var\(--panel-2\)/su,
    );
  });
});
