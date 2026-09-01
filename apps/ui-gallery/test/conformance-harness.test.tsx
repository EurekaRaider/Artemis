// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { artemisThemeCss, artemisThemeManifest } from "@artemis/theme-artemis";
import {
  SEMANTIC_TOKEN_REGISTRY,
  validateSkinPackage,
} from "@artemis/theme-contract";
import {
  CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
  ConformanceProbe,
} from "@artemis/ui/conformance";

import conformanceMatrix from "../src/conformance-matrix.json" with { type: "json" };
import {
  applyGalleryMode,
  applyGallerySkin,
  GALLERY_TOKEN_PROVENANCE,
  GalleryApp,
  installGalleryStressSkinStyles,
  type GalleryMode,
  type GallerySkin,
} from "../src/gallery-app.js";
import {
  STRESS_SKIN_ID,
  stressSkinCss,
  stressSkinPackage,
} from "../src/stress-skin-fixture.mjs";

type ConformanceCase =
  | "anatomy"
  | "aria-relations"
  | "finite-states"
  | "controlled-boundary"
  | "ime-enter"
  | "callback-order"
  | "action-policy"
  | "rtl-inheritance";

class ProbeErrorBoundary extends Component<
  { readonly children: ReactNode; readonly onError: (error: Error) => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

beforeEach(() => {
  applyGallerySkin("default");
  document.head.querySelector("style[data-gallery-stress-skin]")?.remove();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
  anatomy() {
    const { container } = render(
      <ConformanceProbe label="Matrix anatomy" defaultValue="value" />,
    );
    const root = container.querySelector(
      '[data-artemis-component="conformance-probe"]',
    );
    expect(root?.getAttribute("data-part")).toBe("root");
    expect(root?.getAttribute("data-state")).toBe("ready");
    expect(
      [...container.querySelectorAll("[data-part]")].map((part) =>
        part.getAttribute("data-part"),
      ),
    ).toEqual(["root", "label", "control", "description", "error"]);
  },

  "aria-relations"() {
    const blankLabelErrors: unknown[] = [];
    const blankLabelRender = render(
      <ProbeErrorBoundary onError={(error) => blankLabelErrors.push(error)}>
        <ConformanceProbe label={"\u200B\u2060"} />
      </ProbeErrorBoundary>,
      { onCaughtError: () => undefined },
    );
    expect(blankLabelErrors).toHaveLength(1);
    expect(blankLabelErrors[0]).toBeInstanceOf(Error);
    expect((blankLabelErrors[0] as Error).message).toBe(
      CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
    );
    expect(
      blankLabelRender.container.querySelector(
        '[data-artemis-component="conformance-probe"]',
      ),
    ).toBeNull();
    blankLabelRender.unmount();

    const { container } = render(
      <ConformanceProbe
        id="matrix-aria"
        label="Matrix ARIA"
        description="Description"
        error="Error"
      />,
    );
    const root = screen.getByRole("group", { name: "Matrix ARIA" });
    const control = screen.getByRole("textbox", { name: "Matrix ARIA" });
    const label = container.querySelector('[data-part="label"]');
    expect(root.getAttribute("aria-labelledby")).toBe("matrix-aria-label");
    expect(label?.getAttribute("for")).toBe("matrix-aria-control");
    expect(control.getAttribute("aria-describedby")).toBe(
      "matrix-aria-description matrix-aria-error",
    );
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(label?.textContent).toBe("Matrix ARIA");
  },

  "finite-states"() {
    const { container, rerender } = render(
      <ConformanceProbe label="Matrix state" />,
    );
    const state = () =>
      container
        .querySelector('[data-artemis-component="conformance-probe"]')
        ?.getAttribute("data-state");
    expect(state()).toBe("ready");
    rerender(<ConformanceProbe label="Matrix state" error="Error" />);
    expect(state()).toBe("error");
    rerender(<ConformanceProbe label="Matrix state" stale />);
    expect(state()).toBe("stale");
    rerender(<ConformanceProbe label="Matrix state" busy />);
    expect(state()).toBe("busy");
    rerender(<ConformanceProbe label="Matrix state" disabled />);
    expect(state()).toBe("disabled");
  },

  "controlled-boundary"() {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ConformanceProbe
        label="Matrix controlled"
        value="fixed"
        onValueChange={onValueChange}
      />,
    );
    const control = screen.getByRole("textbox", {
      name: "Matrix controlled",
    });
    fireEvent.change(control, { target: { value: "requested" } });
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("requested");
    expect(control).toHaveProperty("value", "fixed");
    rerender(
      <ConformanceProbe
        label="Matrix controlled"
        value="accepted"
        onValueChange={onValueChange}
      />,
    );
    expect(control).toHaveProperty("value", "accepted");
  },

  "ime-enter"() {
    const onCommit = vi.fn();
    render(
      <ConformanceProbe
        label="Matrix IME"
        defaultValue="中"
        onCommit={onCommit}
      />,
    );
    const control = screen.getByRole("textbox", { name: "Matrix IME" });
    fireEvent.compositionStart(control);
    fireEvent.keyDown(control, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(control);
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("中");
  },

  "callback-order"() {
    const order: string[] = [];
    render(
      <ConformanceProbe
        label="Matrix callbacks"
        defaultValue="a"
        onValueChange={(value) => order.push(`onValueChange:${value}`)}
        onCommit={(value) => order.push(`onCommit:${value}`)}
        onEvent={(event) => order.push(`onEvent:${event.type}:${event.value}`)}
      />,
    );
    const control = screen.getByRole("textbox", {
      name: "Matrix callbacks",
    });
    fireEvent.change(control, { target: { value: "ab" } });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(order).toEqual([
      "onValueChange:ab",
      "onEvent:change:ab",
      "onCommit:ab",
      "onEvent:commit:ab",
    ]);
  },

  "action-policy"() {
    const onValueChange = vi.fn();
    const onCommit = vi.fn();
    const onEvent = vi.fn();
    const { container, rerender } = render(
      <ConformanceProbe
        label="Matrix actions"
        defaultValue="value"
        disabled
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    let control = screen.getByRole("textbox", { name: "Matrix actions" });
    fireEvent.change(control, { target: { value: "blocked" } });
    fireEvent.keyDown(control, { key: "Enter" });
    control.focus();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(control);

    rerender(
      <ConformanceProbe
        label="Matrix actions"
        defaultValue="value"
        busy
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    control = screen.getByRole("textbox", { name: "Matrix actions" });
    fireEvent.change(control, { target: { value: "blocked" } });
    fireEvent.keyDown(control, { key: "Enter" });
    control.focus();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(control);

    rerender(
      <ConformanceProbe
        label="Matrix actions"
        defaultValue="value"
        stale
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    control = screen.getByRole("textbox", { name: "Matrix actions" });
    fireEvent.change(control, { target: { value: "stale-allowed" } });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("stale-allowed");
    expect(onCommit).toHaveBeenCalledWith("stale-allowed");
    expect(onEvent).toHaveBeenCalledTimes(2);
    onValueChange.mockClear();
    onCommit.mockClear();
    onEvent.mockClear();

    rerender(
      <ConformanceProbe
        label="Matrix actions"
        defaultValue="value"
        error="Error"
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    control = screen.getByRole("textbox", { name: "Matrix actions" });
    fireEvent.change(control, { target: { value: "error-allowed" } });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("error-allowed");
    expect(onCommit).toHaveBeenCalledWith("error-allowed");
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(
      container
        .querySelector('[data-artemis-component="conformance-probe"]')
        ?.getAttribute("data-state"),
    ).toBe("error");
  },

  "rtl-inheritance"() {
    const { container } = render(
      <div dir="rtl">
        <ConformanceProbe label="Matrix RTL" />
      </div>,
    );
    const probe = container.querySelector(
      '[data-artemis-component="conformance-probe"]',
    );
    expect(probe?.closest('[dir="rtl"]')).not.toBeNull();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },
} satisfies Record<ConformanceCase, () => void>;

const conformanceCases = conformanceMatrix.skins.default as ConformanceCase[];
const skinCaseMatrix = (["default", "stress"] as const).flatMap((skin) =>
  conformanceCases.map((caseName) => ({ skin, caseName })),
);

const galleryVertices = (["default", "stress"] as const).flatMap((skin) =>
  (["light", "dark"] as const).flatMap((theme) =>
    (["normal", "high"] as const).map((contrast) => ({
      skin,
      theme,
      contrast,
    })),
  ),
) satisfies readonly GalleryMode[];

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
  const group = screen.getByRole("group", { name: label });
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
    screen.getByRole("group", { name: label }),
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

  it("renders all 74 computed formal CSS tokens at every Gallery vertex", async () => {
    installFormalComputedStyle();
    const user = userEvent.setup();
    const { container } = render(<GalleryApp />);
    const provenance = container.querySelector(
      "[data-gallery-token-provenance]",
    );
    expect(provenance?.getAttribute("data-gallery-token-provenance")).toBe(
      GALLERY_TOKEN_PROVENANCE,
    );
    expect(Object.keys(SEMANTIC_TOKEN_REGISTRY)).toHaveLength(74);
    expect(formalCssModes.size).toBe(8);

    for (const mode of galleryVertices) {
      await selectMode(user, mode);
      const expected = formalCssModes.get(rootModeKey())!;
      expect(expected.size).toBe(74);
      await waitFor(() => {
        const outputs = container.querySelectorAll<HTMLOutputElement>(
          "output[data-gallery-token]",
        );
        expect(outputs).toHaveLength(74);
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

  it("traverses all eight vertices and returns without remount or state, selection, focus, anatomy, or ARIA loss", async () => {
    const user = userEvent.setup();
    const { container } = render(<GalleryApp />);
    const control = screen.getByRole("textbox", { name: "Synthetic value" });
    await user.type(control, "-changed");
    control.focus();
    control.setSelectionRange(2, 5);
    const originalParts = [...container.querySelectorAll("[data-part]")].map(
      (part) => part.getAttribute("data-part"),
    );
    const root = control.closest(
      '[data-artemis-component="conformance-probe"]',
    );
    const label = container.querySelector('[data-part="label"]');
    const eventOrder = container.querySelector("[data-gallery-event-order]");
    const eventOrderSnapshot = eventOrder?.textContent;
    const ariaSnapshot = {
      rootLabelledBy: root?.getAttribute("aria-labelledby"),
      rootBusy: root?.getAttribute("aria-busy"),
      labelFor: label?.getAttribute("for"),
      controlDescribedBy: control.getAttribute("aria-describedby"),
      controlInvalid: control.getAttribute("aria-invalid"),
      controlBusy: control.getAttribute("aria-busy"),
    };
    expect(ariaSnapshot.rootLabelledBy).toBe(label?.id);
    expect(ariaSnapshot.labelFor).toBe(control.id);
    for (const mode of [...galleryVertices, galleryVertices[0]!]) {
      await selectMode(user, mode);
      expectRootMode(mode);
      const afterSwitch = screen.getByRole("textbox", {
        name: "Synthetic value",
      });
      expect(afterSwitch).toBe(control);
      expect(afterSwitch).toHaveProperty("value", "preserve-changed");
      expect(afterSwitch).toHaveProperty("selectionStart", 2);
      expect(afterSwitch).toHaveProperty("selectionEnd", 5);
      expect(document.activeElement).toBe(afterSwitch);
      expect(container.querySelector("[data-gallery-event-order]")).toBe(
        eventOrder,
      );
      expect(eventOrder?.textContent).toBe(eventOrderSnapshot);
      const afterRoot = afterSwitch.closest(
        '[data-artemis-component="conformance-probe"]',
      );
      const afterLabel = container.querySelector('[data-part="label"]');
      expect({
        rootLabelledBy: afterRoot?.getAttribute("aria-labelledby"),
        rootBusy: afterRoot?.getAttribute("aria-busy"),
        labelFor: afterLabel?.getAttribute("for"),
        controlDescribedBy: afterSwitch.getAttribute("aria-describedby"),
        controlInvalid: afterSwitch.getAttribute("aria-invalid"),
        controlBusy: afterSwitch.getAttribute("aria-busy"),
      }).toEqual(ariaSnapshot);
      expect(
        [...container.querySelectorAll("[data-part]")].map((part) =>
          part.getAttribute("data-part"),
        ),
      ).toEqual(originalParts);
    }
    expect(
      document.head.querySelector("style[data-gallery-stress-skin]"),
    ).not.toBeNull();
  });

  it("binds every declared matrix case to a real behavior runner", () => {
    expect(conformanceMatrix.skins.stress).toEqual(
      conformanceMatrix.skins.default,
    );
    expect(Object.keys(caseRunners).sort()).toEqual(
      [...conformanceMatrix.skins.default].sort(),
    );
    expect(skinCaseMatrix).toHaveLength(16);
  });

  it.each(skinCaseMatrix)(
    "$caseName behavior passes under the $skin skin",
    ({ skin, caseName }) => {
      prepareSkin(skin);
      caseRunners[caseName]();
    },
  );
});
