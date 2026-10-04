// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentModelInfo,
  Automation,
  ModelSelection,
  Project,
} from "@artemis/protocol";
import type {
  SaveAutomationInput,
  SettingsSnapshot,
} from "../src/shared/api.js";
import "../src/renderer/i18n.js";
import { AutomationPage } from "../src/renderer/AutomationPage.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const project: Project = {
  id: "project-1",
  name: "Sample project",
  path: "/tmp/sample-project",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const reasoningModel: AgentModelInfo = {
  providerId: "sample",
  modelId: "reasoner",
  name: "Sample Reasoner",
  configured: true,
  reasoning: true,
  thinkingLevels: ["low", "high", "max"],
  contextWindow: 128000,
};
const fastModel: AgentModelInfo = {
  ...reasoningModel,
  modelId: "fast",
  name: "Sample Fast",
  reasoning: false,
  thinkingLevels: ["off"],
};
const defaultSelection: ModelSelection = {
  providerId: "sample",
  modelId: "reasoner",
  thinkingLevel: "high",
};
const settings: Pick<
  SettingsSnapshot,
  "models" | "addedModels" | "providers" | "selection"
> = {
  models: [
    reasoningModel,
    fastModel,
    {
      ...fastModel,
      modelId: "unconfigured",
      name: "Unavailable",
      configured: false,
    },
  ],
  addedModels: [reasoningModel, fastModel],
  providers: [],
  selection: defaultSelection,
};
const automation: Automation = {
  id: "automation-1",
  projectId: project.id,
  name: "Daily review",
  prompt: "Review the sample workspace.",
  mode: "plan",
  target: "local",
  enabled: true,
  authorizationState: "not-required",
  schedule: {
    kind: "weekly",
    daysOfWeek: [1, 2, 3, 4, 5],
    localTime: "09:00",
    timeZone: "UTC",
  },
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

async function setup(
  options: {
    records?: Automation[];
    settings?: typeof settings;
    save?: (input: SaveAutomationInput) => Promise<Automation>;
  } = {},
) {
  const save = vi.fn(
    options.save ??
      (async (input: SaveAutomationInput) => ({ ...automation, ...input })),
  );
  const remove = vi.fn(async () => {});
  const confirm = vi.fn(async () => true);
  stubWindowArtemis({
    listAutomations: async () => options.records ?? [],
    listAutomationRuns: async () => [],
    onAutomationEvent: () => () => {},
    saveAutomation: save,
    deleteAutomation: remove,
    authorizeAutomation: async () => {},
  });
  render(
    <AutomationPage
      locale="en"
      projects={[project]}
      settings={options.settings ?? settings}
      onConfirm={confirm}
      onOpenThread={() => {}}
    />,
  );
  await act(async () => {});
  return { save, remove, confirm };
}
async function create() {
  await userEvent.click(screen.getByRole("button", { name: "New automation" }));
  await userEvent.type(screen.getByLabelText("Name"), "Morning review");
  await userEvent.type(
    screen.getByLabelText("Task instructions"),
    "Review the workspace.",
  );
}
async function choose(label: string, value: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(
    screen.getByRole("option", { name: value, exact: true }),
  );
}

describe("automation model selection", () => {
  it("shows the real default model, limits effort choices, and saves explicit settings", async () => {
    const { save } = await setup();
    await create();
    expect(screen.getByLabelText("Model")).toHaveTextContent("Sample Reasoner");
    expect(screen.getByLabelText("Reasoning effort")).toHaveTextContent("High");
    await userEvent.click(screen.getByLabelText("Model"));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(
      screen.getByRole("option", { name: "Sample Fast", exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Sample Reasoner", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByLabelText("Reasoning effort"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(
      screen.getByRole("option", { name: "High", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await userEvent.click(
      screen.getByRole("option", { name: "Low", exact: true }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save", exact: true }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          modelSelection: { ...defaultSelection, thinkingLevel: "low" },
        }),
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resets reasoning when switching to a non-reasoning model", async () => {
    const { save } = await setup();
    await create();
    await choose("Model", "Sample Fast");
    expect(screen.getByLabelText("Reasoning effort")).toBeDisabled();
    expect(screen.getByLabelText("Reasoning effort")).toHaveTextContent("Off");
    await userEvent.click(
      screen.getByRole("button", { name: "Save", exact: true }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          modelSelection: {
            providerId: "sample",
            modelId: "fast",
            thinkingLevel: "off",
          },
        }),
      ),
    );
  });

  it.each([undefined, { ...defaultSelection, thinkingLevel: "low" as const }])(
    "restores an existing task selection or initializes a legacy task from the default (%j)",
    async (modelSelection) => {
      const record = {
        ...automation,
        ...(modelSelection ? { modelSelection } : {}),
      };
      const { save } = await setup({ records: [record] });
      await userEvent.click(
        screen.getByRole("button", { name: "Edit", exact: true }),
      );
      expect(screen.getByLabelText("Model")).toHaveTextContent(
        "Sample Reasoner",
      );
      expect(screen.getByLabelText("Reasoning effort")).toHaveTextContent(
        modelSelection ? "Low" : "High",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Save", exact: true }),
      );
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            id: automation.id,
            modelSelection: modelSelection ?? defaultSelection,
          }),
        ),
      );
    },
  );

  it("blocks an unavailable saved model until the user chooses an available model", async () => {
    await setup({
      records: [
        {
          ...automation,
          modelSelection: { ...defaultSelection, modelId: "removed-model" },
        },
      ],
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Edit", exact: true }),
    );
    expect(screen.getByLabelText("Model")).toHaveTextContent("removed-model");
    expect(
      screen.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Model")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await choose("Model", "Sample Reasoner");
    expect(
      screen.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
  });

  it("preserves inputs and displays failed saves inside the dialog", async () => {
    const { save } = await setup({
      save: async () => {
        throw new Error("Model configuration changed");
      },
    });
    await create();
    await userEvent.click(
      screen.getByRole("button", { name: "Save", exact: true }),
    );
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Model configuration changed",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Morning review");
    expect(screen.getByLabelText("Model")).toHaveTextContent("Sample Reasoner");
    save.mockResolvedValueOnce(automation);
    await userEvent.click(
      screen.getByRole("button", { name: "Save", exact: true }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("requires the existing confirmation before deleting from the overflow menu", async () => {
    const { remove, confirm } = await setup({ records: [automation] });
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Delete", exact: true }),
    );
    await waitFor(() => expect(remove).toHaveBeenCalledWith(automation.id));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
