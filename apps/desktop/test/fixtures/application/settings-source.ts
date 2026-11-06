import { readRendererFeatureSources } from "./renderer-feature-source.js";
export function readSettingsPanelSources(): string {
  return readRendererFeatureSources(
    "app/SettingsPanel.tsx",
    ["settings/controllers"],
    ["settings/settings-values.ts"],
  );
}
