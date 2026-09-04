import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

const appSource = source("../src/renderer/App.tsx");
const contextBarSource = source("../src/renderer/ComposerContextBar.tsx");
const desktopStyles = source("../src/renderer/styles.css");
const taskPlanSource = source("../src/renderer/task-plan.ts");
const resourceOverridesSource = source(
  "../../../packages/agent-host/src/resource-overrides.ts",
);
const publicStyles = source("../../../packages/ui/src/styles.css");
const themeSource = source("../../../packages/theme-artemis/src/index.ts");
const readme = source("../../../README.md");

describe("reported issues #104-#129", () => {
  it("restores and persists each project's collapsed disclosure state (#104)", () => {
    expect(appSource).toContain(
      "window.artemis.setCollapsedProjectIds(projectIds)",
    );
    expect(appSource).toContain("const persistedCollapsed = new Set(");
    expect(appSource).toContain(
      "collapsedProjectIdsPersistence.current?.initialize([",
    );
    expect(appSource).toContain("setProjectCollapsed(");
  });

  it("keeps plan progress incremental while a turn is active (#105)", () => {
    expect(resourceOverridesSource).toContain("whenever a step status changes");
    expect(taskPlanSource).toContain(
      'event.payload.toolName !== "update_plan"',
    );
    expect(taskPlanSource).toContain(
      "const latestTurnIndex = events.findLastIndex",
    );
  });

  it("locks task mode only for the current active turn (#113)", () => {
    expect(contextBarSource).toContain("modeActionsDisabled: boolean");
    expect(contextBarSource).toContain("disabled={modeActionsDisabled}");
    expect(contextBarSource).toContain("branchActionsDisabled: boolean");
    expect(appSource).toContain("modeActionsDisabled={turnActive || busy}");
  });

  it("keeps interactive project tasks Local-only (#119)", () => {
    expect(readme).toContain(
      "Project-backed interactive tasks always use the project's Local checkout",
    );
  });

  it("shows queued work as static instead of the running pulse (#127)", () => {
    expect(appSource).toContain('threadState.activity?.phase === "queued"');
    expect(desktopStyles).toMatch(
      /\.status-dot\.queued\s*\{[^}]*background:\s*var\(--muted-2\)/u,
    );
    expect(desktopStyles).toMatch(
      /\.status-dot\.running\s*\{[^}]*animation:\s*pulse/u,
    );
  });

  it("uses a 320ms shell-eased sidebar transition (#129)", () => {
    expect(themeSource).toContain(
      '"motion.duration.normal": { kind: "duration", value: 320, unit: "ms" }',
    );
    expect(publicStyles).toContain(
      "grid-template-columns var(--artemis-motion-duration-normal)",
    );
    expect(publicStyles).toContain(
      "transform var(--artemis-motion-duration-normal)",
    );
    expect(publicStyles).toContain("var(--artemis-motion-easing-shell)");
  });
});
