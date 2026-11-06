// @vitest-environment jsdom
import { galleryCss } from "./fixtures/conformance/shared.js";
import { dataCases } from "./fixtures/conformance/data.js";
import { managementCases } from "./fixtures/conformance/management.js";
import { workflowCases } from "./fixtures/conformance/workflow.js";
import { professionalCases } from "./fixtures/conformance/professional.js";
import { workspaceCases } from "./fixtures/conformance/workspace.js";
import { conversationCases } from "./fixtures/conformance/conversation.js";
import { surfaceCases } from "./fixtures/conformance/surface.js";
import { layoutPatternsCases } from "./fixtures/conformance/layout-patterns.js";
import { feedbackCases } from "./fixtures/conformance/feedback.js";
import { navigationCases } from "./fixtures/conformance/navigation.js";
import { formsCases } from "./fixtures/conformance/forms.js";
import { actionsCases } from "./fixtures/conformance/actions.js";
import { coreCases } from "./fixtures/conformance/core.js";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { artemisThemeCss, artemisThemeManifest } from "@artemis/theme-artemis";
import {
  SEMANTIC_TOKEN_REGISTRY,
  validateSkinPackage,
} from "@artemis/theme-contract";

import conformanceMatrix from "../src/conformance/conformance-matrix.json" with { type: "json" };
import {
  applyGalleryMode,
  applyGallerySkin,
  GALLERY_TOKEN_PROVENANCE,
  GalleryApp,
  installGalleryStressSkinStyles,
  type GalleryMode,
  type GallerySkin,
} from "../src/app/gallery-app.js";
import {
  STRESS_SKIN_ID,
  stressSkinCss,
  stressSkinPackage,
} from "../src/themes/stress-skin-fixture.mjs";

type ConformanceCase =
  | "anatomy"
  | "aria-relations"
  | "finite-states"
  | "controlled-boundary"
  | "ime-enter"
  | "callback-order"
  | "action-policy"
  | "rtl-inheritance"
  | "action-anatomy"
  | "action-states"
  | "action-variants-sizes"
  | "action-events"
  | "icon-contract"
  | "status-semantics"
  | "form-anatomy"
  | "form-states"
  | "form-events-ime"
  | "form-semantics"
  | "navigation-anatomy"
  | "navigation-events"
  | "feedback-anatomy"
  | "overlay-focus-and-close"
  | "portal-viewport-geometry"
  | "layout-anatomy"
  | "split-pane-events"
  | "pattern-anatomy"
  | "pattern-state-matrix"
  | "pattern-events"
  | "pattern-rtl-long-content"
  | "surface-anatomy"
  | "surface-controlled-events"
  | "surface-rtl-long-content"
  | "conversation-anatomy"
  | "conversation-state-matrix"
  | "conversation-controlled-events"
  | "conversation-rtl-long-content"
  | "workspace-anatomy"
  | "workspace-state-matrix"
  | "workspace-controlled-events"
  | "workspace-rtl-long-content"
  | "professional-anatomy"
  | "professional-state-matrix"
  | "professional-controlled-events"
  | "professional-rtl-long-content"
  | "workflow-anatomy"
  | "workflow-state-matrix"
  | "workflow-controlled-events"
  | "workflow-permission-boundary"
  | "workflow-rtl-overlay-geometry"
  | "management-anatomy"
  | "management-state-matrix"
  | "management-controlled-events"
  | "management-permission-boundary"
  | "management-rtl-long-content"
  | "data-anatomy"
  | "data-state-matrix"
  | "data-controlled-events"
  | "data-rtl-long-content";

beforeEach(() => {
  applyGallerySkin("default");
  document.documentElement.dir = "ltr";
  document.documentElement.style.removeProperty("zoom");
  document.head.querySelector("style[data-gallery-stress-skin]")?.remove();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function prepareMode(mode: GalleryMode): void {
  applyGalleryMode(mode);
  if (mode.skin === "stress") installGalleryStressSkinStyles();
  expect(document.documentElement.dataset.artemisSkin).toBe(
    mode.skin === "stress" ? STRESS_SKIN_ID : artemisThemeManifest.id,
  );
  expect(document.documentElement.dataset.artemisTheme).toBe(mode.theme);
  expect(document.documentElement.dataset.artemisContrast).toBe(mode.contrast);
  expect(
    document.head.querySelector("style[data-gallery-stress-skin]") !== null,
  ).toBe(mode.skin === "stress");
}

function prepareSkin(skin: GallerySkin): void {
  prepareMode({ skin, theme: "light", contrast: "normal" });
}
const caseRunners = {
  ...coreCases,
  ...actionsCases,
  ...formsCases,
  ...navigationCases,
  ...feedbackCases,
  ...layoutPatternsCases,
  ...surfaceCases,
  ...conversationCases,
  ...workspaceCases,
  ...professionalCases,
  ...workflowCases,
  ...managementCases,
  ...dataCases,
} satisfies Record<ConformanceCase, () => void | Promise<void>>;

const conformanceCases = conformanceMatrix.skins.default as ConformanceCase[];
const skinCaseMatrix = (["default", "stress"] as const).flatMap((skin) =>
  conformanceCases.map((caseName) => ({ skin, caseName })),
);

function expectCompleteTabRelations(root: ParentNode): void {
  const tablists = [
    ...root.querySelectorAll<HTMLElement>(
      '[data-artemis-component="tabs"][role="tablist"]',
    ),
  ];
  expect(tablists.length).toBeGreaterThan(0);
  for (const tablist of tablists) {
    const tabs = [
      ...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    for (const tab of tabs) {
      const panelId = tab.getAttribute("aria-controls");
      expect(panelId).toBeTruthy();
      const panel = panelId ? document.getElementById(panelId) : null;
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(
        document.getElementById(panel?.getAttribute("aria-labelledby") ?? ""),
      ).toBe(tab);
      expect((panel as HTMLElement | null)?.hidden).toBe(
        tab.getAttribute("aria-selected") !== "true",
      );
    }
  }
}

const galleryVertices = (
  conformanceMatrix.runtimeAxes.skins as GallerySkin[]
).flatMap((skin) =>
  (conformanceMatrix.runtimeAxes.themes as GalleryMode["theme"][]).flatMap(
    (theme) =>
      (
        conformanceMatrix.runtimeAxes.contrasts as GalleryMode["contrast"][]
      ).map((contrast) => ({
        skin,
        theme,
        contrast,
      })),
  ),
) satisfies readonly GalleryMode[];

interface RuntimeEnvironment {
  readonly direction: "ltr" | "rtl";
  readonly zoomFactor: 1 | 2;
  readonly reducedMotion: boolean;
}

const runtimeEnvironments = (
  conformanceMatrix.runtimeAxes.directions as RuntimeEnvironment["direction"][]
).flatMap((direction) =>
  (
    conformanceMatrix.runtimeAxes
      .zoomFactors as RuntimeEnvironment["zoomFactor"][]
  ).flatMap((zoomFactor) =>
    conformanceMatrix.runtimeAxes.reducedMotion.map((reducedMotion) => ({
      direction,
      zoomFactor,
      reducedMotion,
    })),
  ),
) satisfies readonly RuntimeEnvironment[];

const runtimeVertices = runtimeEnvironments.flatMap((environment) =>
  galleryVertices.map((mode) => ({ environment, mode })),
);

function applyRuntimeEnvironment(environment: RuntimeEnvironment): void {
  document.documentElement.dir = environment.direction;
  document.documentElement.style.setProperty(
    "zoom",
    String(environment.zoomFactor),
  );
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches:
          query === "(prefers-reduced-motion: reduce)" &&
          environment.reducedMotion,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      }) satisfies MediaQueryList,
  );
}

const galleryAxes = ["skin", "theme", "contrast"] as const;

const galleryEdges = galleryVertices.flatMap((from) => {
  const edges: Array<{
    readonly axis: (typeof galleryAxes)[number];
    readonly from: GalleryMode;
    readonly label: "Skin" | "Theme" | "Contrast";
    readonly option: string;
    readonly to: GalleryMode;
  }> = [];
  if (from.skin === "default") {
    edges.push({
      axis: "skin",
      from,
      label: "Skin",
      option: "Stress",
      to: { ...from, skin: "stress" },
    });
  }
  if (from.theme === "light") {
    edges.push({
      axis: "theme",
      from,
      label: "Theme",
      option: "Dark",
      to: { ...from, theme: "dark" },
    });
  }
  if (from.contrast === "normal") {
    edges.push({
      axis: "contrast",
      from,
      label: "Contrast",
      option: "High",
      to: { ...from, contrast: "high" },
    });
  }
  return edges;
});

function parseGeneratedCss(css: string) {
  const modes = new Map<string, ReadonlyMap<string, string>>();
  const blockPattern =
    /:root\[data-artemis-skin="([^"]+)"\]\[data-artemis-theme="(light|dark)"\]\[data-artemis-contrast="(normal|high)"\] \{\n([\s\S]*?)\n\}/gu;
  for (const match of css.matchAll(blockPattern)) {
    const declarations = new Map<string, string>();
    for (const line of match[4]!.split("\n")) {
      const declaration = /^\s*(--artemis-[a-z0-9-]+):\s*(.+);$/u.exec(line);
      if (declaration === null) {
        throw new Error(`Unexpected generated declaration: ${line}`);
      }
      declarations.set(declaration[1]!, declaration[2]!);
    }
    modes.set(`${match[1]}|${match[2]}|${match[3]}`, declarations);
  }
  return modes;
}

const formalCssModes = new Map([
  ...parseGeneratedCss(artemisThemeCss),
  ...parseGeneratedCss(stressSkinCss),
]);

function rootModeKey(): string {
  return [
    document.documentElement.dataset.artemisSkin,
    document.documentElement.dataset.artemisTheme,
    document.documentElement.dataset.artemisContrast,
  ].join("|");
}

function installFormalComputedStyle(): void {
  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element, pseudoElement) => {
      if (element !== document.documentElement) {
        return nativeGetComputedStyle(element, pseudoElement);
      }
      const declarations = formalCssModes.get(rootModeKey());
      if (declarations === undefined) {
        throw new Error(`Missing formal CSS mode: ${rootModeKey()}`);
      }
      return {
        getPropertyValue(property: string) {
          return declarations.get(property) ?? "";
        },
      } as CSSStyleDeclaration;
    },
  );
}

async function selectAxis(
  user: ReturnType<typeof userEvent.setup>,
  label: "Skin" | "Theme" | "Contrast",
  option: string,
): Promise<void> {
  const group = within(
    document.querySelector<HTMLElement>(
      '[aria-label="Gallery mode controls"]',
    )!,
  ).getByRole("group", { name: label });
  const button = within(group).getByRole("button", { name: option });
  if (button.getAttribute("aria-pressed") !== "true") await user.click(button);
}

async function selectMode(
  user: ReturnType<typeof userEvent.setup>,
  mode: GalleryMode,
): Promise<void> {
  await selectAxis(
    user,
    "Skin",
    mode.skin === "default" ? "Direction A" : "Stress",
  );
  await selectAxis(user, "Theme", mode.theme === "light" ? "Light" : "Dark");
  await selectAxis(
    user,
    "Contrast",
    mode.contrast === "normal" ? "Normal" : "High",
  );
}

function expectRootMode(mode: GalleryMode): void {
  expect(document.documentElement.dataset.artemisSkin).toBe(
    mode.skin === "default" ? artemisThemeManifest.id : STRESS_SKIN_ID,
  );
  expect(document.documentElement.dataset.artemisTheme).toBe(mode.theme);
  expect(document.documentElement.dataset.artemisContrast).toBe(mode.contrast);
}

function expectPressedAxis(
  label: "Skin" | "Theme" | "Contrast",
  selectedOption: string,
): void {
  const buttons = within(
    within(
      document.querySelector<HTMLElement>(
        '[aria-label="Gallery mode controls"]',
      )!,
    ).getByRole("group", {
      name: label,
    }),
  ).getAllByRole("button");
  for (const button of buttons) {
    expect(button.getAttribute("aria-pressed")).toBe(
      String(button.textContent === selectedOption),
    );
  }
}

function rootModeAttributes(): Readonly<
  Record<(typeof galleryAxes)[number], string | undefined>
> {
  return {
    skin: document.documentElement.dataset.artemisSkin,
    theme: document.documentElement.dataset.artemisTheme,
    contrast: document.documentElement.dataset.artemisContrast,
  };
}

describe("default and synthetic stress skin conformance", () => {
  it("uses schema-valid data and a fixed root-only token serializer", () => {
    expect(validateSkinPackage(stressSkinPackage).valid).toBe(true);
    expect(galleryEdges).toHaveLength(12);
    expect(runtimeVertices).toHaveLength(64);
    expect(conformanceMatrix.fallbackCases).toEqual([
      "unknown",
      "unavailable",
      "unsupported",
      "load-failed",
      "default-fatal",
    ]);
    expect(galleryCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.gallery-motion-swatch\s*\{[\s\S]*?transition:\s*none/u,
    );
    expect(stressSkinCss).toContain(
      `:root[data-artemis-skin="${STRESS_SKIN_ID}"][data-artemis-theme="light"][data-artemis-contrast="normal"]`,
    );
    expect(stressSkinCss).toContain("--artemis-typography-body-family");
    expect(stressSkinCss).not.toMatch(/url\s*\(|@import|https?:|data:/iu);
    const selectors = stressSkinCss
      .split("\n")
      .filter((line) => line.trim().endsWith("{"));
    expect(selectors[0]).toBe("@layer artemis.theme {");
    expect(
      selectors.slice(1).every((selector) => selector.startsWith(":root[")),
    ).toBe(true);
    installGalleryStressSkinStyles();
    installGalleryStressSkinStyles();
    expect(
      document.head.querySelectorAll("style[data-gallery-stress-skin]"),
    ).toHaveLength(1);
  });

  it.each(galleryVertices)(
    "initializes the $skin/$theme/$contrast vertex from root attributes",
    (mode) => {
      prepareMode(mode);
      render(<GalleryApp />);
      expectRootMode(mode);
      const status = screen.getByText(
        `Active mode: ${mode.skin} / ${mode.theme} / ${mode.contrast}`,
      );
      expect(status.getAttribute("data-gallery-active-skin")).toBe(mode.skin);
      expect(status.getAttribute("data-gallery-active-theme")).toBe(mode.theme);
      expect(status.getAttribute("data-gallery-active-contrast")).toBe(
        mode.contrast,
      );
      expectPressedAxis(
        "Skin",
        mode.skin === "default" ? "Direction A" : "Stress",
      );
      expectPressedAxis("Theme", mode.theme === "light" ? "Light" : "Dark");
      expectPressedAxis(
        "Contrast",
        mode.contrast === "normal" ? "Normal" : "High",
      );
    },
  );

  it.each(galleryEdges)(
    "changes only $axis on the $from.skin/$from.theme/$from.contrast cube edge",
    async ({ axis, from, label, option, to }) => {
      prepareMode(from);
      const user = userEvent.setup();
      render(<GalleryApp />);
      const before = rootModeAttributes();
      await selectAxis(user, label, option);
      const after = rootModeAttributes();

      expectRootMode(to);
      expect(after[axis]).not.toBe(before[axis]);
      for (const unchangedAxis of galleryAxes.filter(
        (candidate) => candidate !== axis,
      )) {
        expect(after[unchangedAxis]).toBe(before[unchangedAxis]);
      }
    },
  );

  it("renders all 106 computed formal CSS tokens at every Gallery vertex", async () => {
    installFormalComputedStyle();
    const user = userEvent.setup();
    const { container } = render(<GalleryApp />);
    const provenance = container.querySelector(
      "[data-gallery-token-provenance]",
    );
    expect(provenance?.getAttribute("data-gallery-token-provenance")).toBe(
      GALLERY_TOKEN_PROVENANCE,
    );
    expect(Object.keys(SEMANTIC_TOKEN_REGISTRY)).toHaveLength(106);
    expect(formalCssModes.size).toBe(8);

    for (const mode of galleryVertices) {
      await selectMode(user, mode);
      const expected = formalCssModes.get(rootModeKey())!;
      expect(expected.size).toBe(106);
      await waitFor(() => {
        const outputs = container.querySelectorAll<HTMLOutputElement>(
          "output[data-gallery-token]",
        );
        expect(outputs).toHaveLength(106);
        for (const output of outputs) {
          const name = output.dataset.galleryToken!;
          const variable =
            SEMANTIC_TOKEN_REGISTRY[
              name as keyof typeof SEMANTIC_TOKEN_REGISTRY
            ].cssVariable;
          expect(output.value, `${rootModeKey()} ${name}`).toBe(
            expected.get(variable),
          );
        }
      });
    }
  });

  it("traverses all 64 runtime vertices and returns without remount or state, selection, focus, anatomy, or ARIA loss", async () => {
    const user = userEvent.setup();
    const { container } = render(<GalleryApp />);
    const probeControl = screen.getByRole("textbox", {
      name: "Synthetic value",
    });
    await user.type(probeControl, "-changed");
    const formControl = screen.getByRole("textbox", {
      name: "Controlled text",
    }) as HTMLInputElement;
    await user.type(formControl, "-changed");
    const modelRoot = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-artemis-component="select"]',
      ),
    ].find(
      (candidate) =>
        candidate.querySelector('[data-part="label"]')?.textContent === "Model",
    );
    const modelTrigger = modelRoot?.querySelector<HTMLButtonElement>(
      '[data-part="trigger"]',
    );
    expect(modelTrigger).toBeDefined();
    await user.click(modelTrigger!);
    await user.click(
      screen.getByRole("option", { name: "Beta · vision and long context" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Controlled checkbox" }),
    );
    formControl.focus();
    formControl.setSelectionRange(2, 5);
    const activityTabs = screen.getByRole("tablist", {
      name: "Activity views",
    });
    const detailsTab = within(activityTabs).getByRole("tab", {
      name: "A very long localized activity comparison",
    });
    await user.click(detailsTab);
    const markdownSegments = screen.getByRole("group", {
      name: "Markdown view",
    });
    const sourceSegment = within(markdownSegments).getByRole("button", {
      name: "Source",
    });
    await user.click(sourceSegment);
    detailsTab.focus();
    const probeRoot = probeControl.closest(
      '[data-artemis-component="conformance-probe"]',
    )!;
    const originalParts = [...probeRoot.querySelectorAll("[data-part]")].map(
      (part) => part.getAttribute("data-part"),
    );
    const root = probeRoot;
    const label = probeRoot.querySelector('[data-part="label"]');
    const primaryAction = screen.getByRole("button", {
      name: "compact primary",
    });
    const actionStatus = screen
      .getByText("2.5K / 10K")
      .closest('[data-artemis-component="status"]')!;
    const actionSnapshot = {
      component: primaryAction.getAttribute("data-artemis-component"),
      state: primaryAction.getAttribute("data-state"),
      variant: primaryAction.getAttribute("data-variant"),
      statusComponent: actionStatus.getAttribute("data-artemis-component"),
      statusTone: actionStatus.getAttribute("data-tone"),
      statusLive: actionStatus.getAttribute("aria-live"),
    };
    const eventOrder = container.querySelector("[data-gallery-event-order]");
    const eventOrderSnapshot = eventOrder?.textContent;
    const ariaSnapshot = {
      rootLabelledBy: root?.getAttribute("aria-labelledby"),
      rootBusy: root?.getAttribute("aria-busy"),
      labelFor: label?.getAttribute("for"),
      controlDescribedBy: probeControl.getAttribute("aria-describedby"),
      controlInvalid: probeControl.getAttribute("aria-invalid"),
      controlBusy: probeControl.getAttribute("aria-busy"),
    };
    expect(ariaSnapshot.rootLabelledBy).toBe(label?.id);
    expect(ariaSnapshot.labelFor).toBe(probeControl.id);

    const formSelector = [
      '[data-artemis-component="text-field"]',
      '[data-artemis-component="search-field"]',
      '[data-artemis-component="select"]',
      '[data-artemis-component="checkbox"]',
      '[data-artemis-component="switch"]',
    ].join(", ");
    const snapshotFormRoot = (formRoot: HTMLElement) => {
      const publicControl = formRoot.querySelector<HTMLElement>(
        '[data-part="control"], [data-part="trigger"]',
      );
      return {
        root: formRoot,
        partNodes: [...formRoot.querySelectorAll<HTMLElement>("[data-part]")],
        contract: {
          component: formRoot.dataset.artemisComponent,
          state: formRoot.dataset.state,
          size: formRoot.dataset.size,
          labelVisibility: formRoot.dataset.labelVisibility,
          parts: [...formRoot.querySelectorAll<HTMLElement>("[data-part]")].map(
            (part) => ({
              part: part.dataset.part,
              id: part.id,
              role: part.getAttribute("role"),
              ariaChecked: part.getAttribute("aria-checked"),
              ariaControls: part.getAttribute("aria-controls"),
              ariaDescribedBy: part.getAttribute("aria-describedby"),
              ariaDisabled: part.getAttribute("aria-disabled"),
              ariaExpanded: part.getAttribute("aria-expanded"),
              ariaInvalid: part.getAttribute("aria-invalid"),
              ariaLabelledBy: part.getAttribute("aria-labelledby"),
              ariaSelected: part.getAttribute("aria-selected"),
            }),
          ),
          control:
            publicControl === null
              ? null
              : {
                  tagName: publicControl.tagName,
                  type:
                    publicControl instanceof HTMLInputElement
                      ? publicControl.type
                      : null,
                  value:
                    publicControl instanceof HTMLInputElement ||
                    publicControl instanceof HTMLButtonElement
                      ? publicControl.value
                      : null,
                  checked:
                    publicControl instanceof HTMLInputElement
                      ? publicControl.checked
                      : null,
                  disabled:
                    publicControl instanceof HTMLInputElement ||
                    publicControl instanceof HTMLButtonElement
                      ? publicControl.disabled
                      : null,
                },
        },
      };
    };
    const formSnapshots = [
      ...container.querySelectorAll<HTMLElement>(formSelector),
    ].map(snapshotFormRoot);
    expect(formSnapshots.length).toBeGreaterThanOrEqual(16);
    for (const component of [
      "text-field",
      "search-field",
      "select",
      "checkbox",
      "switch",
    ]) {
      expect(
        [
          ...new Set(
            formSnapshots
              .filter((snapshot) => snapshot.contract.component === component)
              .map((snapshot) => snapshot.contract.size),
          ),
        ].sort(),
      ).toEqual(["comfortable", "compact"]);
    }
    const navigationSelector = [
      '[data-artemis-component="tabs"]',
      '[data-artemis-component="segmented-control"]',
    ].join(", ");
    const snapshotNavigationRoot = (navigationRoot: HTMLElement) => ({
      root: navigationRoot,
      parts: [...navigationRoot.querySelectorAll<HTMLElement>("[data-part]")],
      contract: {
        component: navigationRoot.dataset.artemisComponent,
        state: navigationRoot.dataset.state,
        size: navigationRoot.dataset.size,
        label: navigationRoot.getAttribute("aria-label"),
        parts: [
          ...navigationRoot.querySelectorAll<HTMLElement>("[data-part]"),
        ].map((part) => ({
          part: part.dataset.part,
          id: part.id,
          role: part.getAttribute("role"),
          ariaControls: part.getAttribute("aria-controls"),
          ariaPressed: part.getAttribute("aria-pressed"),
          ariaSelected: part.getAttribute("aria-selected"),
          disabled:
            part instanceof HTMLButtonElement ? part.disabled : undefined,
          tabIndex: part.getAttribute("tabindex"),
        })),
      },
    });
    const navigationSnapshots = [
      ...container.querySelectorAll<HTMLElement>(navigationSelector),
    ].map(snapshotNavigationRoot);
    // Markdown modes and Settings theme are persistent segmented controls.
    expect(navigationSnapshots).toHaveLength(10);
    expect(detailsTab.getAttribute("aria-selected")).toBe("true");
    expect(sourceSegment.getAttribute("aria-pressed")).toBe("true");
    expectCompleteTabRelations(container);
    const feedbackLayoutSelector = [
      '[data-artemis-component="inline-notice"]',
      '[data-artemis-component="toast"]',
      '[data-artemis-component="empty-state"]',
      '[data-artemis-component="loading-state"]',
      '[data-artemis-component="error-state"]',
      '[data-artemis-component="toolbar"]',
      '[data-artemis-component="list-row"]',
      '[data-artemis-component="panel-header"]',
      '[data-artemis-component="scroll-area"]',
      '[data-artemis-component="split-pane"]',
    ].join(", ");
    const feedbackLayoutRoots = [
      ...container.querySelectorAll<HTMLElement>(feedbackLayoutSelector),
    ];
    const splitSeparator = screen.getByRole("separator", {
      name: "Resize activity navigation",
    });
    fireEvent.keyDown(splitSeparator, { key: "ArrowRight" });
    expect(splitSeparator.getAttribute("aria-valuenow")).toBe("256");
    const feedbackLayoutContracts = feedbackLayoutRoots.map((root) => ({
      component: root.dataset.artemisComponent,
      state: root.dataset.state,
      tone: root.dataset.tone,
      parts: [...root.querySelectorAll<HTMLElement>("[data-part]")].map(
        (part) => ({
          part: part.dataset.part,
          role: part.getAttribute("role"),
          ariaLabel: part.getAttribute("aria-label"),
          ariaSelected: part.getAttribute("aria-selected"),
          ariaValueNow: part.getAttribute("aria-valuenow"),
        }),
      ),
    }));
    detailsTab.focus();
    for (const { environment, mode } of [
      ...runtimeVertices,
      runtimeVertices[0]!,
    ]) {
      applyRuntimeEnvironment(environment);
      await selectMode(user, mode);
      expectRootMode(mode);
      expect(document.documentElement.dir).toBe(environment.direction);
      expect(document.documentElement.style.getPropertyValue("zoom")).toBe(
        String(environment.zoomFactor),
      );
      expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(
        environment.reducedMotion,
      );
      const afterSwitch = within(
        container.querySelector<HTMLElement>(
          '[data-artemis-component="conformance-probe"]',
        )!,
      ).getByRole("textbox", {
        name: "Synthetic value",
      });
      expect(afterSwitch).toBe(probeControl);
      expect(afterSwitch).toHaveProperty("value", "preserve-changed");
      const formQueries = within(
        container.querySelector<HTMLElement>(
          'section[aria-labelledby="form-heading"]',
        )!,
      );
      const afterFormControl = formQueries.getByRole("textbox", {
        name: "Controlled text",
      });
      expect(afterFormControl).toBe(formControl);
      expect(afterFormControl).toHaveProperty(
        "value",
        "Editable value-changed",
      );
      expect(afterFormControl).toHaveProperty("selectionStart", 2);
      expect(afterFormControl).toHaveProperty("selectionEnd", 5);
      expect(document.activeElement).toBe(detailsTab);
      expect(modelTrigger?.textContent).toContain(
        "Beta · vision and long context",
      );
      expect(
        (
          formQueries.getByRole("checkbox", {
            name: "Controlled checkbox",
          }) as HTMLInputElement
        ).checked,
      ).toBe(false);
      expect(
        (
          formQueries.getByRole("switch", {
            name: "Controlled switch",
          }) as HTMLInputElement
        ).checked,
      ).toBe(false);
      expect(container.querySelector("[data-gallery-event-order]")).toBe(
        eventOrder,
      );
      const afterFormRoots = [
        ...container.querySelectorAll<HTMLElement>(formSelector),
      ];
      expect(afterFormRoots).toHaveLength(formSnapshots.length);
      for (const [index, snapshot] of formSnapshots.entries()) {
        const afterRoot = afterFormRoots[index]!;
        const afterSnapshot = snapshotFormRoot(afterRoot);
        expect(afterRoot).toBe(snapshot.root);
        expect(afterSnapshot.partNodes).toHaveLength(snapshot.partNodes.length);
        for (const [partIndex, partNode] of snapshot.partNodes.entries()) {
          expect(afterSnapshot.partNodes[partIndex]).toBe(partNode);
        }
        expect(afterSnapshot.contract).toEqual(snapshot.contract);
      }
      const afterNavigationRoots = [
        ...container.querySelectorAll<HTMLElement>(navigationSelector),
      ];
      expect(afterNavigationRoots).toHaveLength(navigationSnapshots.length);
      for (const [index, snapshot] of navigationSnapshots.entries()) {
        const afterNavigationRoot = afterNavigationRoots[index]!;
        const afterSnapshot = snapshotNavigationRoot(afterNavigationRoot);
        expect(afterNavigationRoot).toBe(snapshot.root);
        expect(afterSnapshot.parts).toHaveLength(snapshot.parts.length);
        for (const [partIndex, part] of snapshot.parts.entries()) {
          expect(afterSnapshot.parts[partIndex]).toBe(part);
        }
        expect(afterSnapshot.contract).toEqual(snapshot.contract);
      }
      expect(detailsTab.getAttribute("aria-selected")).toBe("true");
      expect(sourceSegment.getAttribute("aria-pressed")).toBe("true");
      expectCompleteTabRelations(container);
      const afterFeedbackLayoutRoots = [
        ...container.querySelectorAll<HTMLElement>(feedbackLayoutSelector),
      ];
      expect(afterFeedbackLayoutRoots).toHaveLength(feedbackLayoutRoots.length);
      for (const [index, feedbackLayoutRoot] of feedbackLayoutRoots.entries()) {
        const after = afterFeedbackLayoutRoots[index]!;
        expect(after).toBe(feedbackLayoutRoot);
        expect({
          component: after.dataset.artemisComponent,
          state: after.dataset.state,
          tone: after.dataset.tone,
          parts: [...after.querySelectorAll<HTMLElement>("[data-part]")].map(
            (part) => ({
              part: part.dataset.part,
              role: part.getAttribute("role"),
              ariaLabel: part.getAttribute("aria-label"),
              ariaSelected: part.getAttribute("aria-selected"),
              ariaValueNow: part.getAttribute("aria-valuenow"),
            }),
          ),
        }).toEqual(feedbackLayoutContracts[index]);
      }
      expect(splitSeparator.getAttribute("aria-valuenow")).toBe("256");
      expect(
        within(
          container.querySelector<HTMLElement>(
            'section[aria-labelledby="navigation-heading"]',
          )!,
        ).getByRole("tabpanel", {
          name: "A very long localized activity comparison",
        }).id,
      ).toBe("gallery-details-panel");
      const actionQueries = within(
        container.querySelector<HTMLElement>(
          'section[aria-labelledby="action-heading"]',
        )!,
      );
      const afterPrimaryAction = actionQueries.getByRole("button", {
        name: "compact primary",
      });
      const afterActionStatus = actionQueries
        .getByText("2.5K / 10K")
        .closest('[data-artemis-component="status"]')!;
      expect(afterPrimaryAction).toBe(primaryAction);
      expect(afterActionStatus).toBe(actionStatus);
      expect({
        component: afterPrimaryAction.getAttribute("data-artemis-component"),
        state: afterPrimaryAction.getAttribute("data-state"),
        variant: afterPrimaryAction.getAttribute("data-variant"),
        statusComponent: afterActionStatus.getAttribute(
          "data-artemis-component",
        ),
        statusTone: afterActionStatus.getAttribute("data-tone"),
        statusLive: afterActionStatus.getAttribute("aria-live"),
      }).toEqual(actionSnapshot);
      expect(eventOrder?.textContent).toBe(eventOrderSnapshot);
      const afterRoot = afterSwitch.closest(
        '[data-artemis-component="conformance-probe"]',
      );
      const afterLabel = afterRoot?.querySelector('[data-part="label"]');
      expect({
        rootLabelledBy: afterRoot?.getAttribute("aria-labelledby"),
        rootBusy: afterRoot?.getAttribute("aria-busy"),
        labelFor: afterLabel?.getAttribute("for"),
        controlDescribedBy: probeControl.getAttribute("aria-describedby"),
        controlInvalid: probeControl.getAttribute("aria-invalid"),
        controlBusy: probeControl.getAttribute("aria-busy"),
      }).toEqual(ariaSnapshot);
      expect(
        [...(afterRoot?.querySelectorAll("[data-part]") ?? [])].map((part) =>
          part.getAttribute("data-part"),
        ),
      ).toEqual(originalParts);
    }
    expect(
      document.head.querySelector("style[data-gallery-stress-skin]"),
    ).not.toBeNull();
    // Keep every vertex and visibility/ARIA check within the same time budget.
  }, 90_000);

  it("binds every declared matrix case to a real behavior runner", () => {
    expect(conformanceMatrix.skins.stress).toEqual(
      conformanceMatrix.skins.default,
    );
    expect(Object.keys(caseRunners).sort()).toEqual(
      [...conformanceMatrix.skins.default].sort(),
    );
    expect(skinCaseMatrix).toHaveLength(116);
  });

  it.each(skinCaseMatrix)(
    "$caseName behavior passes under the $skin skin",
    async ({ skin, caseName }) => {
      prepareSkin(skin);
      await caseRunners[caseName]();
    },
  );
});
