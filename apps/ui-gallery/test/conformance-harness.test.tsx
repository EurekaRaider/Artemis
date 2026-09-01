// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
  ConformanceProbe,
} from "@artemis/ui/conformance";
import { validateSkinPackage } from "@artemis/theme-contract";

import conformanceMatrix from "../src/conformance-matrix.json" with { type: "json" };
import {
  applyGallerySkin,
  GalleryApp,
  installGalleryStressSkinStyles,
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
afterEach(cleanup);

function prepareSkin(skin: GallerySkin): void {
  applyGallerySkin(skin);
  if (skin === "stress") installGalleryStressSkinStyles();
  expect(document.documentElement.dataset.artemisSkin).toBe(
    skin === "stress" ? STRESS_SKIN_ID : "com.artemis.default",
  );
  expect(document.documentElement.dataset.artemisTheme).toBe("light");
  expect(document.documentElement.dataset.artemisContrast).toBe("normal");
  expect(
    document.head.querySelector("style[data-gallery-stress-skin]") !== null,
  ).toBe(skin === "stress");
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

describe("default and synthetic stress skin conformance", () => {
  it("uses schema-valid data and a fixed root-only token serializer", () => {
    expect(validateSkinPackage(stressSkinPackage).valid).toBe(true);
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

  it.each(["default", "stress"] as const)(
    "initializes GalleryApp coherently from the %s root skin",
    (skin) => {
      prepareSkin(skin);
      render(<GalleryApp />);
      expect(
        screen
          .getByText(`Active harness skin: ${skin}`)
          .getAttribute("data-gallery-active-skin"),
      ).toBe(skin);
      expect(
        screen.getByRole("button", {
          name: `Use ${skin === "default" ? "stress" : "default"} skin`,
        }),
      ).not.toBeNull();
    },
  );

  it("switches skin without remounting or losing value, selection, focus, anatomy, or ARIA", async () => {
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
    await user.click(screen.getByRole("button", { name: "Use stress skin" }));

    const afterSwitch = screen.getByRole("textbox", {
      name: "Synthetic value",
    });
    expect(afterSwitch).toBe(control);
    expect(afterSwitch).toHaveProperty("value", "preserve-changed");
    expect(afterSwitch).toHaveProperty("selectionStart", 2);
    expect(afterSwitch).toHaveProperty("selectionEnd", 5);
    expect(document.activeElement).toBe(afterSwitch);
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
    expect(document.documentElement.dataset.artemisSkin).toBe(STRESS_SKIN_ID);
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
