// @vitest-environment jsdom
//
// D#76 PR9C §5 test matrix: input field contracts for the two real product
// entries that own the renderer's only date and file inputs:
//   1. AutomationPage once-schedule <input required type="date"> (§2.1 entry 1)
//   2. SettingsPanel profile avatar <input accept="image/jpeg,png,webp" type="file"> (§2.1 entry 2)
//
// The avatar keyboard-reachability assertions are deliberately source-level:
// jsdom applies no CSS, so "display:none removes the input from the tab
// order" can only be locked by asserting the styles.css contract directly
// (same convention as icon-sizing.test.ts / renderer-layout.test.ts). The
// behavioral DOM contracts jsdom can observe are asserted by rendering the
// real components. Real keyboard activation through the Electron file picker
// is covered by the smoke script (verify:input-fields), not by this file.
//
// Synthetic data only (PR9C checklist 安全边界): every project name, prompt,
// settings snapshot, avatar blob, and automation record below is fabricated
// for this file — no real project, credential, or user image appears here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";

import "../src/renderer/i18n.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { AutomationPage } from "../src/renderer/AutomationPage.js";
import { SettingsPanel } from "../src/renderer/SettingsPanel.js";
import type { AgentModelInfo, Automation, Project } from "@artemis/protocol";
import type { SettingsSnapshot } from "../src/shared/api.js";

const stylesSource = readFileSync(
  resolve(process.cwd(), "src/renderer/styles.css"),
  "utf8",
);
const appSource = readFileSync(
  resolve(process.cwd(), "src/renderer/App.tsx"),
  "utf8",
);
const rendererDir = resolve(process.cwd(), "src/renderer");
const rendererSources: Record<string, string> = {};
const collectRendererSources = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      collectRendererSources(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      rendererSources[entry] = readFileSync(full, "utf8");
    }
  }
};
collectRendererSources(rendererDir);

function cssRuleBlock(styles: string, selector: string): string {
  const needle = `${selector} {`;
  const at = styles.indexOf(needle);
  if (at === -1) {
    throw new Error(`selector not found in styles.css: ${needle}`);
  }
  const open = styles.indexOf("{", at);
  const close = styles.indexOf("}", open);
  return styles.slice(open + 1, close);
}

const syntheticProject: Project = {
  id: "synthetic-project",
  name: "synthetic-project",
  path: "/tmp/synthetic-project",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function savedAutomation(): Automation {
  return {
    id: "synthetic-automation-1",
    projectId: "synthetic-project",
    name: "Synthetic sweep",
    prompt: "Run the synthetic sweep.",
    mode: "review",
    target: "local",
    schedule: {
      // The UI "Every day" preset persists as the protocol's real weekly
      // shape with all seven days (AutomationPage scheduleForDraft), so this
      // fixture mirrors the persisted record; the protocol never had a
      // "daily" schedule kind.
      kind: "weekly",
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      localTime: "09:00",
      timeZone: "UTC",
    },
    enabled: true,
    authorizationState: "not-required",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

function stubAutomationApi(overrides: Record<string, unknown> = {}) {
  stubWindowArtemis({
    onAutomationEvent: () => () => {},
    listAutomations: () => Promise.resolve([]),
    listAutomationRuns: () => Promise.resolve([]),
    saveAutomation: () => Promise.resolve(savedAutomation()),
    authorizeAutomation: () => Promise.resolve(),
    runAutomationNow: () => Promise.resolve(),
    setAutomationEnabled: () => Promise.resolve(),
    deleteAutomation: () => Promise.resolve(),
    ...overrides,
  });
}

function settingsSnapshot(
  overrides: Record<string, unknown> = {},
): SettingsSnapshot {
  return {
    platform: "darwin",
    encryptionAvailable: true,
    language: "system",
    theme: "system",
    resolvedLocale: "en",
    approvalPolicy: "ask",
    localFullAccess: false,
    shell: { windowsPreference: "auto", profileMode: "environment" },
    fullAccessAvailable: false,
    contextWindow: 258_000,
    models: [],
    addedModels: [],
    credentials: [],
    providers: [],
    mcpServers: [],
    globalAgents: { path: "/tmp/agents.md", content: "" },
    trustedExtensions: [],
    update: {
      state: "idle",
      currentVersion: "0.0.0-synthetic",
      rollbackAvailable: false,
    },
    agentConcurrency: {
      preference: { mode: "auto" },
      configuredLimit: 8,
      automaticSafeLimit: 8,
      startupLimit: 8,
      effectiveLimit: 8,
      active: 0,
      waiting: 0,
      queued: 0,
      hardLimit: 8,
      logicalLimit: 8,
      throttled: false,
      pressureReasons: [],
      parallelism: 1,
      totalMemoryGiB: 16,
    },
    ...overrides,
  } as unknown as SettingsSnapshot;
}

const syntheticModel: AgentModelInfo = {
  providerId: "synthetic-provider",
  modelId: "synthetic-model",
  name: "Synthetic Model",
  reasoning: false,
  contextWindow: 258_000,
  configured: true,
};

function stubSettingsApi(
  snapshot: SettingsSnapshot,
  overrides: Record<string, unknown> = {},
) {
  stubWindowArtemis({
    getSettings: () => Promise.resolve(snapshot),
    onUpdateStatus: () => () => {},
    setProfileAvatar: () => Promise.resolve(snapshot),
    ...overrides,
  });
}

async function openAutomationDraftDialog() {
  render(
    <AutomationPage
      locale="en"
      projects={[syntheticProject]}
      onConfirm={() => Promise.resolve(true)}
      onOpenThread={() => {}}
    />,
  );
  await act(async () => {});
  await userEvent.click(screen.getByRole("button", { name: "New automation" }));
}

async function fillValidDraft() {
  await userEvent.type(screen.getByLabelText("Name"), "Synthetic sweep");
  await userEvent.type(
    screen.getByLabelText("Prompt"),
    "Run the synthetic sweep.",
  );
}

async function chooseAutomationOption(label: string, option: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(screen.getByRole("option", { name: option }));
}

async function renderSettingsPanel(
  snapshot: SettingsSnapshot,
  initialTab:
    | "general"
    | "providers"
    | "agents"
    | "capabilities"
    | "maintenance" = "general",
) {
  render(
    <SettingsPanel
      initialSettings={snapshot}
      initialTab={initialTab}
      locale="en"
      onClose={() => {}}
      onSettingsChange={() => {}}
    />,
  );
  await act(async () => {});
}

const avatarInput = () =>
  screen.getByLabelText("Choose image") as HTMLInputElement;

describe("automation project select compatibility", () => {
  it("keeps duplicate and reserved project names perceptibly distinct", async () => {
    const projects: Project[] = [
      { ...syntheticProject, id: "one", name: "Shared", path: "/tmp/one" },
      { ...syntheticProject, id: "two", name: "Shared", path: "/tmp/two" },
      {
        ...syntheticProject,
        id: "reserved",
        name: "All projects",
        path: "/tmp/reserved",
      },
    ];
    stubAutomationApi();
    render(
      <AutomationPage
        locale="en"
        projects={projects}
        onConfirm={() => Promise.resolve(true)}
        onOpenThread={() => {}}
      />,
    );
    await act(async () => {});

    await userEvent.click(screen.getByLabelText("Project"));
    const labels = screen
      .getAllByRole("option")
      .map((option) => (option.textContent ?? "").replace(/^✓/u, ""));
    expect(labels).toEqual([
      "All projects",
      "Shared — /tmp/one",
      "Shared — /tmp/two",
      "All projects — /tmp/reserved",
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps a partial automation editable when its project is unavailable", async () => {
    const unavailable = {
      ...savedAutomation(),
      projectId: "unavailable-project",
    };
    stubAutomationApi({
      listAutomations: () => Promise.resolve([unavailable]),
    });
    render(
      <AutomationPage
        locale="en"
        projects={[syntheticProject]}
        onConfirm={() => Promise.resolve(true)}
        onOpenThread={() => {}}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    const project = within(dialog).getByLabelText("Project");
    expect(project).toBeDisabled();
    expect(project).toHaveTextContent("Unavailable project");
  });
});

describe("date field contract (AutomationPage once schedule, §5 date-合同)", () => {
  it("renders the date input only when the schedule preset is once", async () => {
    stubAutomationApi();
    await openAutomationDraftDialog();
    expect(screen.queryByLabelText("Date")).toBeNull();
    await chooseAutomationOption("Schedule", "Once");
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    await chooseAutomationOption("Schedule", "Every day");
    expect(screen.queryByLabelText("Date")).toBeNull();
  });

  it("names the date input through its implicit label and marks it required", async () => {
    stubAutomationApi();
    await openAutomationDraftDialog();
    await chooseAutomationOption("Schedule", "Once");
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.required).toBe(true);
    expect(date.closest("label")?.textContent).toContain("Date");
  });

  it("round-trips a picked date from the control into the saved once schedule", async () => {
    const saveAutomation = vi.fn(() => Promise.resolve(savedAutomation()));
    stubAutomationApi({ saveAutomation });
    await openAutomationDraftDialog();
    await fillValidDraft();
    await chooseAutomationOption("Schedule", "Once");
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-09-15" } });
    expect(date.value).toBe("2026-09-15");
    fireEvent.submit(date.closest("form")!);
    await waitFor(() => expect(saveAutomation).toHaveBeenCalledTimes(1));
    const payload = saveAutomation.mock.calls[0]?.[0] as {
      schedule: { kind: string; at?: string };
    };
    expect(payload.schedule.kind).toBe("once");
    const expectedAt = Temporal.PlainDateTime.from("2026-09-15T09:00")
      .toZonedDateTime(Intl.DateTimeFormat().resolvedOptions().timeZone, {
        disambiguation: "compatible",
      })
      .toInstant()
      .toString({ smallestUnit: "millisecond" });
    expect(payload.schedule.at).toBe(expectedAt);
  });
});

describe("date field state contract (§5 date-状态, §2.1 verification outcome)", () => {
  it("disables the date input while the automation is saving", async () => {
    let resolveSave!: (automation: Automation) => void;
    stubAutomationApi({
      saveAutomation: () =>
        new Promise<Automation>((resolve) => {
          resolveSave = resolve;
        }),
    });
    await openAutomationDraftDialog();
    await fillValidDraft();
    await chooseAutomationOption("Schedule", "Once");
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    expect(date.disabled).toBe(false);
    fireEvent.submit(date.closest("form")!);
    expect(date.disabled).toBe(true);
    resolveSave(savedAutomation());
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps native constraint validation active so an empty required date blocks saving", async () => {
    stubAutomationApi();
    await openAutomationDraftDialog();
    await chooseAutomationOption("Schedule", "Once");
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "" } });
    const form = date.closest("form")!;
    expect(date.required).toBe(true);
    expect(form.noValidate).toBe(false);
    expect(date.validity.valueMissing).toBe(true);
    expect(date.checkValidity()).toBe(false);
    expect(form.checkValidity()).toBe(false);
  });
});

describe("avatar file field contract (SettingsPanel general tab, §5 file-合同)", () => {
  it("locks the accept whitelist, accessible label, and file type", async () => {
    stubSettingsApi(settingsSnapshot());
    await renderSettingsPanel(settingsSnapshot());
    const input = avatarInput();
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
    expect(input).toHaveAccessibleName("Choose image");
    expect(input.nextElementSibling).toHaveTextContent("Choose image");
  });

  it("clears the input value after a pick so the same file can be re-picked", async () => {
    const decodeFailure = "jsdom cannot decode images";
    window.createImageBitmap = vi
      .fn()
      .mockRejectedValue(new Error(decodeFailure));
    try {
      stubSettingsApi(settingsSnapshot());
      await renderSettingsPanel(settingsSnapshot());
      const input = avatarInput();
      expect(input.value).toBe("");
      await userEvent.upload(
        input,
        new File([new Uint8Array([137, 80, 78, 71])], "synthetic-avatar.png", {
          type: "image/png",
        }),
      );
      expect(input.value).toBe("");
      await screen.findByText(decodeFailure);
    } finally {
      delete window.createImageBitmap;
    }
  });

  it("disables the input and remove control while an avatar change is saving", async () => {
    let resolveChange!: (snapshot: SettingsSnapshot) => void;
    const setProfileAvatar = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveChange = resolve;
        }),
    );
    stubSettingsApi(
      settingsSnapshot({
        profileAvatar: "data:image/webp;base64,c3ludGhldGlj",
      }),
      { setProfileAvatar },
    );
    await renderSettingsPanel(
      settingsSnapshot({
        profileAvatar: "data:image/webp;base64,c3ludGhldGlj",
      }),
    );
    const input = screen.getByLabelText("Change image") as HTMLInputElement;
    const remove = screen.getByRole("button", { name: "Remove" });
    await userEvent.click(remove);
    expect(input.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    resolveChange(settingsSnapshot());
    await waitFor(() => expect(input.disabled).toBe(false));
  });

  it("renders the remove control only when an avatar is set", async () => {
    stubSettingsApi(settingsSnapshot());
    await renderSettingsPanel(settingsSnapshot());
    expect(screen.getByLabelText("Choose image")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
  });
});

describe("settings management operation contract (MIG5A)", () => {
  it("keeps every Settings tab linked to a mounted tabpanel", async () => {
    const initial = settingsSnapshot({ models: [syntheticModel] });
    stubSettingsApi(initial);
    await renderSettingsPanel(initial, "providers");

    for (const selector of [".settings-tabs", ".provider-config-tabs"]) {
      const tablist = document.querySelector(selector);
      expect(tablist).not.toBeNull();
      const tabs = [...tablist!.querySelectorAll<HTMLElement>('[role="tab"]')];
      expect(tabs.length).toBeGreaterThan(1);
      for (const tab of tabs) {
        const panelId = tab.getAttribute("aria-controls");
        const panel = panelId ? document.getElementById(panelId) : null;
        expect(panel).not.toBeNull();
        expect(panel).toHaveAttribute("role", "tabpanel");
        expect(panel).toHaveAttribute("aria-labelledby", tab.id);
        expect(panel!.hidden).toBe(
          tab.getAttribute("aria-selected") !== "true",
        );
      }
    }
    expect(document.querySelector(".settings-tabs")).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    expect(document.querySelector(".provider-config-tabs")).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
  });

  it("shows configuration-import safety warnings without exposing source paths", async () => {
    const initial = settingsSnapshot({ models: [syntheticModel] });
    const hiddenPath = "/synthetic-user/.config/synthetic-agent/config.json";
    const warning =
      'codex MCP "synthetic-server" authentication values were not copied; configure authentication in Artemis.';
    stubSettingsApi(initial, {
      scanConfigurationImports: () =>
        Promise.resolve({
          sources: [
            {
              source: "codex",
              detected: true,
              paths: [hiddenPath],
              counts: { instructions: 1, skills: 2, mcp: 1 },
              warnings: [warning],
            },
          ],
        }),
    });
    await renderSettingsPanel(initial, "agents");

    await userEvent.click(
      screen.getByRole("button", {
        name: "Scan Codex, OpenCode, and Claude Code",
      }),
    );

    expect(await screen.findByText(warning)).toBeVisible();
    expect(document.body).not.toHaveTextContent(hiddenPath);
  });

  it("blocks same-tick duplicate add-model IPC calls", async () => {
    const initial = settingsSnapshot({ models: [syntheticModel] });
    const updated = settingsSnapshot({
      models: [syntheticModel],
      addedModels: [
        {
          providerId: syntheticModel.providerId,
          modelId: syntheticModel.modelId,
          contextWindow: syntheticModel.contextWindow,
        },
      ],
    });
    let resolveAdd!: (snapshot: SettingsSnapshot) => void;
    const addModel = vi.fn(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    stubSettingsApi(initial, { addModel });
    await renderSettingsPanel(initial, "providers");

    const add = screen.getByRole("button", { name: "Add model" });
    fireEvent.click(add);
    fireEvent.click(add);

    expect(addModel).toHaveBeenCalledTimes(1);
    expect(add).toBeDisabled();
    await act(async () => resolveAdd(updated));
    await screen.findByText("Model added");
  });

  it("preserves a stored credential when the password field stays blank", async () => {
    const initial = settingsSnapshot({
      models: [syntheticModel],
      credentials: [{ providerId: syntheticModel.providerId, type: "api_key" }],
    });
    const addModel = vi.fn(() => Promise.resolve(initial));
    stubSettingsApi(initial, { addModel });
    await renderSettingsPanel(initial, "providers");

    const credential = screen.getByLabelText(
      "API key · synthetic-provider",
    ) as HTMLInputElement;
    expect(credential.type).toBe("password");
    expect(credential).toHaveAttribute(
      "placeholder",
      "API key already stored — leave blank to keep it",
    );

    await userEvent.click(screen.getByRole("button", { name: "Add model" }));
    await waitFor(() => expect(addModel).toHaveBeenCalledTimes(1));
    expect(addModel.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("keeps an entered credential out of visible text and sends it once", async () => {
    const sentinel = "synthetic-settings-secret-5a";
    const initial = settingsSnapshot({ models: [syntheticModel] });
    const addModel = vi.fn(() => Promise.resolve(initial));
    stubSettingsApi(initial, { addModel });
    await renderSettingsPanel(initial, "providers");

    const credential = screen.getByLabelText(
      "API key · synthetic-provider",
    ) as HTMLInputElement;
    fireEvent.change(credential, { target: { value: sentinel } });
    expect(credential.value).toBe(sentinel);
    expect(document.body.textContent).not.toContain(sentinel);

    await userEvent.click(screen.getByRole("button", { name: "Add model" }));
    await waitFor(() => expect(addModel).toHaveBeenCalledTimes(1));
    expect(addModel.mock.calls[0]?.[1]).toBe(sentinel);
    expect(document.body.textContent).not.toContain(sentinel);
  });
});

describe("avatar keyboard reachability (§5 file-键盘红测, fix ① sr-only)", () => {
  it("does not hide the avatar input with display:none", () => {
    const block = cssRuleBlock(stylesSource, ".profile-avatar-input");
    expect(block).not.toContain("display: none");
  });

  it("hides the avatar input visually with the focusable sr-only clip pattern", () => {
    const block = cssRuleBlock(stylesSource, ".profile-avatar-input");
    expect(block).toContain("position: absolute");
    expect(block).toContain("width: 1px");
    expect(block).toContain("height: 1px");
    expect(block).toContain("padding: 0");
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("clip-path: inset(50%)");
    expect(block).toContain("white-space: nowrap");
  });

  it("shows a focus ring on the public avatar button while the input is focused", () => {
    const block = cssRuleBlock(
      stylesSource,
      '.profile-avatar-input:focus-visible + [data-artemis-component="button"]',
    );
    expect(block).toContain(
      "outline: calc(var(--artemis-border-width-default) * 2) solid var(--blue)",
    );
    expect(block).toContain("outline-offset: calc(var(--artemis-space-1) / 2)");
  });

  it("keeps the native file input as the focusable activation target in the DOM", async () => {
    stubSettingsApi(settingsSnapshot());
    await renderSettingsPanel(settingsSnapshot());
    const input = avatarInput();
    expect(input).not.toHaveAttribute("hidden");
    expect(input).not.toHaveAttribute("aria-hidden");
    expect(input.tabIndex).not.toBe(-1);
    input.focus();
    expect(document.activeElement).toBe(input);
  });
});

describe("composer attachment chain guard (§5 链路防回归)", () => {
  it("keeps the composer picker on the preload-controlled selectPromptAttachments entry", () => {
    expect(appSource).toContain("window.artemis.selectPromptAttachments()");
    const appFileInputs = appSource.match(/type="file"/g) ?? [];
    expect(appFileInputs).toHaveLength(0);
  });

  it("renders exactly one file input and one date input across the renderer", () => {
    const fileOwners = Object.entries(rendererSources).filter(([, source]) =>
      source.includes('type="file"'),
    );
    const dateOwners = Object.entries(rendererSources).filter(([, source]) =>
      source.includes('type="date"'),
    );
    expect(fileOwners.map(([name]) => name)).toEqual(["SettingsPanel.tsx"]);
    expect(dateOwners.map(([name]) => name)).toEqual(["AutomationPage.tsx"]);
  });

  it("leaves the PR9A icon sizing token freeze untouched", () => {
    expect(stylesSource).toContain("--icon-size-xs: 12px");
    expect(stylesSource).toContain("--icon-size-sm: 14px");
    expect(stylesSource).toContain("--icon-size-base: 16px");
    expect(stylesSource).toContain("--icon-size-lg: 20px");
    expect(stylesSource).toContain("--icon-size-xl: 24px");
    const inputBlock = cssRuleBlock(stylesSource, ".profile-avatar-input");
    expect(inputBlock).not.toContain("--icon-size-");
  });
});
