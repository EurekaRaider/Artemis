import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const renderer = resolve(import.meta.dirname, "../../src/renderer");
const read = (file: string) => readFileSync(resolve(renderer, file), "utf8");

// These are composition-root budgets, not a universal line limit. Feature
// ownership assertions below prevent moving business logic back into the roots.
const owners = [
  {
    entry: "app/App.tsx",
    budget: 5000,
    imports: [
      "useComposerSubmission",
      "useReviewController",
      "useConversationHistory",
    ],
    implementations: [
      "const sendPrompt = useCallback",
      "const refreshDiff = useCallback",
      "const loadEarlierHistory = useCallback",
    ],
  },
  {
    entry: "plugins/ResourceCenter.tsx",
    budget: 2900,
    imports: ["useResourceSubscriptions", "useResourceInstallActions"],
    implementations: [
      "window.artemis.installLocalSkill(",
      "window.artemis.listInstalledSkills(",
    ],
  },
  {
    entry: "app/SettingsPanel.tsx",
    budget: 2600,
    imports: ["useSettingsSubscriptions", "useProviderActions"],
    implementations: [
      "window.artemis.saveProviderConnection(",
      "window.artemis.importConfiguration(",
    ],
  },
  {
    entry: "workspace/EnvironmentPanel.tsx",
    budget: 1500,
    imports: ["useEnvironmentGitSubscriptions", "useEnvironmentReservation"],
    implementations: [
      "const loadGit = useCallback",
      "const measureContentSpace = useCallback",
    ],
  },
  {
    entry: "im/ImSettingsPanel.tsx",
    budget: 1150,
    imports: ["useImSettingsSubscriptions", "createImBotActions"],
    implementations: ["window.artemis.saveImSettings("],
  },
  {
    entry: "im/GroupCollaborationPanel.tsx",
    budget: 1200,
    imports: ["useGroupDirectory", "createGroupAuthorizationActions"],
    implementations: ["window.artemis.manageIm("],
  },
  {
    entry: "automation/AutomationPage.tsx",
    budget: 1100,
    imports: ["useAutomationSubscription", "createAutomationActions"],
    implementations: ["window.artemis.saveAutomation("],
  },
  {
    entry: "office/OfficeWorkbenchPanel.tsx",
    budget: 850,
    imports: ["useOfficeSession", "createOfficeAnnotationActions"],
    implementations: ["window.artemis.openOfficeSession("],
  },
] as const;

describe("renderer feature ownership", () => {
  for (const owner of owners) {
    it(`${owner.entry} composes its feature controllers`, () => {
      const source = read(owner.entry);
      expect(source.split("\n").length).toBeLessThanOrEqual(owner.budget);
      for (const name of owner.imports) expect(source).toContain(name);
      for (const implementation of owner.implementations)
        expect(source).not.toContain(implementation);
    });
  }

  it("keeps stylesheet side effects at the owning view", () => {
    const visit = (directory: string): void => {
      for (const entry of readdirSync(resolve(renderer, directory), {
        withFileTypes: true,
      })) {
        const file = `${directory}/${entry.name}`;
        if (entry.isDirectory()) visit(file);
        else if (/\.tsx?$/.test(entry.name)) {
          expect(read(file), file).not.toMatch(/import\s+["'][^"']+\.css["']/u);
        }
      }
    };
    for (const directory of [
      "app/controllers",
      "plugins/controllers",
      "settings/controllers",
      "workspace/environment",
      "im/settings",
      "im/groups",
      "automation/controllers",
      "office/workbench",
    ])
      visit(directory);
  });
});
