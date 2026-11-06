import { readRendererFeatureSources } from "./renderer-feature-source.js";
export function readEnvironmentPanelSources(): string {
  return readRendererFeatureSources("workspace/EnvironmentPanel.tsx", [
    "workspace/environment",
  ]);
}
