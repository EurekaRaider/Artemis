import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Legacy structural contracts inspect the real settings owners. Behavior tests
// continue to render SettingsPanel and exercise its actual handlers and effects.
export function readSettingsPanelSources(): string {
  const renderer = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../src/renderer",
  );
  const controllers = resolve(renderer, "settings/controllers");
  return [
    readFileSync(resolve(renderer, "app/SettingsPanel.tsx"), "utf8"),
    readFileSync(resolve(renderer, "settings/settings-values.ts"), "utf8"),
    ...readdirSync(controllers)
      .filter((file) => file.endsWith(".ts"))
      .sort()
      .map((file) => readFileSync(resolve(controllers, file), "utf8")),
  ].join("\n");
}
