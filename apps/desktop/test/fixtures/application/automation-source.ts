import { readRendererFeatureSources } from "./renderer-feature-source.js";
export function readAutomationPageSources(): string {
  return readRendererFeatureSources(
    "automation/AutomationPage.tsx",
    ["automation/controllers"],
    ["automation/automation-values.ts", "automation/AutomationTimePicker.tsx"],
  );
}
