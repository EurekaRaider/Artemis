// @vitest-environment jsdom
import { readFileSync } from "node:fs";

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
import { Badge, Button, Icon, IconButton, Status } from "@artemis/ui/actions";
import {
  CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
  ConformanceProbe,
} from "@artemis/ui/conformance";
import {
  Checkbox,
  SearchField,
  Select,
  Switch,
  TextField,
} from "@artemis/ui/forms";

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

const galleryCss = readFileSync("src/gallery.css", "utf8");

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
  | "form-semantics";

const MatrixIcon = () => (
  <svg viewBox="0 0 16 16">
    <path d="M2 8h12" />
  </svg>
);

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

  "action-anatomy"() {
    const { container } = render(
      <div>
        <Button icon={<MatrixIcon />}>Button</Button>
        <IconButton icon={<MatrixIcon />} label="Matrix icon button" />
        <Badge tone="success">Complete</Badge>
        <Status tone="info">Running</Status>
      </div>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-artemis-component"),
      ),
    ).toEqual(["button", "icon", "icon-button", "icon", "badge", "status"]);
    expect(container.querySelectorAll('[data-part="indicator"]')).toHaveLength(
      2,
    );
  },

  "action-states"() {
    const statePair = (
      props: Readonly<{
        disabled?: boolean;
        error?: boolean;
        loading?: boolean;
        selected?: boolean;
      }> = {},
    ) => (
      <div>
        <Button {...props}>Matrix state</Button>
        <IconButton
          {...props}
          icon={<MatrixIcon />}
          label="Matrix icon state"
        />
      </div>
    );
    const { container, rerender } = render(statePair());
    const states = () =>
      [...container.querySelectorAll("button")].map((button) =>
        button.getAttribute("data-state"),
      );
    const indicators = [
      ...container.querySelectorAll('[data-part="state-indicator"]'),
    ];
    expect(states()).toEqual(["ready", "ready"]);
    rerender(statePair({ selected: true }));
    expect(states()).toEqual(["selected", "selected"]);
    rerender(statePair({ error: true, selected: true }));
    expect(states()).toEqual(["error", "error"]);
    rerender(statePair({ error: true, loading: true, selected: true }));
    expect(states()).toEqual(["loading", "loading"]);
    rerender(
      statePair({ disabled: true, error: true, loading: true, selected: true }),
    );
    expect(states()).toEqual(["disabled", "disabled"]);
    expect([
      ...container.querySelectorAll('[data-part="state-indicator"]'),
    ]).toEqual(indicators);
  },

  "action-variants-sizes"() {
    const buttonVariants = ["primary", "secondary", "quiet", "danger"] as const;
    const iconButtonVariants = ["secondary", "quiet", "danger"] as const;
    const sizes = ["compact", "comfortable"] as const;
    const states = [
      ["ready", {}],
      ["selected", { selected: true }],
      ["error", { error: true }],
      ["loading", { loading: true }],
      ["disabled", { disabled: true }],
    ] as const;
    const { container } = render(
      <div>
        {sizes.flatMap((size) =>
          buttonVariants.map((variant) => (
            <Button key={`${size}-${variant}`} size={size} variant={variant}>
              {`${size} ${variant}`}
            </Button>
          )),
        )}
        {sizes.flatMap((size) =>
          iconButtonVariants.flatMap((variant) =>
            states.map(([state, stateProps]) => (
              <IconButton
                key={`${size}-${variant}-${state}`}
                icon={<MatrixIcon />}
                label={`${size} ${variant} ${state}`}
                size={size}
                variant={variant}
                {...stateProps}
              />
            )),
          ),
        )}
      </div>,
    );
    const buttons = [
      ...container.querySelectorAll('[data-artemis-component="button"]'),
    ];
    const iconButtons = [
      ...container.querySelectorAll('[data-artemis-component="icon-button"]'),
    ];
    expect(buttons).toHaveLength(sizes.length * buttonVariants.length);
    expect(iconButtons).toHaveLength(
      sizes.length * iconButtonVariants.length * states.length,
    );
    expect(
      new Set(iconButtons.map((node) => node.getAttribute("data-state"))),
    ).toEqual(new Set(states.map(([state]) => state)));
    expect(
      new Set(iconButtons.map((node) => node.getAttribute("data-size"))),
    ).toEqual(new Set(sizes));
    expect(
      new Set(iconButtons.map((node) => node.getAttribute("data-variant"))),
    ).toEqual(new Set(iconButtonVariants));
  },

  async "action-events"() {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Button onClick={onClick}>Activate</Button>
      </form>,
    );
    const action = screen.getByRole("button", { name: "Activate" });
    await user.click(action);
    action.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(action.getAttribute("type")).toBe("button");
  },

  "icon-contract"() {
    const { container } = render(
      <div dir="rtl">
        {(["xs", "sm", "base", "lg", "xl"] as const).map((size) => (
          <Icon key={size} size={size}>
            <MatrixIcon />
          </Icon>
        ))}
        <IconButton icon={<MatrixIcon />} label="图标操作" />
      </div>,
    );
    expect(
      [...container.querySelectorAll('[data-artemis-component="icon"]')].map(
        (node) => node.getAttribute("data-size"),
      ),
    ).toEqual(["xs", "sm", "base", "lg", "xl", "base"]);
    expect(
      [...container.querySelectorAll('[data-artemis-component="icon"]')].every(
        (node) => node.getAttribute("data-part") === "root",
      ),
    ).toBe(true);
    expect(
      container.querySelector(
        '[data-artemis-component="icon-button"] > [data-part="icon"] > [data-artemis-component="icon"]',
      ),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "图标操作" })).not.toBeNull();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },

  "status-semantics"() {
    const longText = "同步完成，所有变更已安全保存到当前本地项目";
    const tones = ["neutral", "info", "success", "warning", "danger"] as const;
    const { container } = render(
      <div>
        <Badge tone="success">{longText}</Badge>
        {tones.map((tone) => (
          <Status
            key={tone}
            live={tone === "warning" ? "polite" : undefined}
            tone={tone}
          >
            {`${tone} status`}
          </Status>
        ))}
      </div>,
    );
    expect(container.textContent).toContain(longText);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(
      [...container.querySelectorAll('[data-artemis-component="status"]')].map(
        (node) => node.getAttribute("data-tone"),
      ),
    ).toEqual(tones);
    expect(container.querySelectorAll('[data-part="indicator"]')).toHaveLength(
      tones.length + 1,
    );
  },

  "form-anatomy"() {
    const { container } = render(
      <div>
        <TextField label="Text" defaultValue="value" />
        <SearchField label="Search" defaultValue="query" />
        <Select
          label="Select"
          onValueChange={() => undefined}
          options={[{ value: "one", label: "One" }]}
          value="one"
        />
        <Checkbox label="Checkbox" defaultChecked />
        <Switch label="Switch" defaultChecked />
      </div>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-artemis-component"),
      ),
    ).toEqual(["text-field", "search-field", "select", "checkbox", "switch"]);
    expect(
      container
        .querySelector('[data-artemis-component="search-field"]')
        ?.querySelectorAll("[data-part]"),
    ).toHaveLength(3);
    expect(
      container
        .querySelector('[data-artemis-component="switch"]')
        ?.querySelector('[data-part="track"] > [data-part="thumb"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },

  "form-states"() {
    const { container } = render(
      <div>
        <TextField label="Ready" defaultValue="ready" />
        <TextField
          label="Read only"
          readOnly
          value="fixed"
          onValueChange={() => undefined}
        />
        <TextField
          error="Invalid"
          label="Error"
          value="bad"
          onValueChange={() => undefined}
        />
        <TextField
          disabled
          error="Invalid"
          label="Disabled"
          value="bad"
          onValueChange={() => undefined}
        />
        <Select
          error="Invalid"
          label="Error select"
          onValueChange={() => undefined}
          options={[{ value: "one", label: "One" }]}
          value="one"
        />
        <Checkbox checked label="Checked" onCheckedChange={() => undefined} />
        <Checkbox
          checked
          error="Invalid"
          label="Error checkbox"
          onCheckedChange={() => undefined}
        />
        <Switch
          checked
          disabled
          error="Invalid"
          label="Disabled switch"
          onCheckedChange={() => undefined}
        />
      </div>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-state"),
      ),
    ).toEqual([
      "ready",
      "read-only",
      "error",
      "disabled",
      "error",
      "checked",
      "error",
      "disabled",
    ]);
  },

  async "form-events-ime"() {
    const user = userEvent.setup();
    const onText = vi.fn();
    const onSelect = vi.fn();
    const onChecked = vi.fn();
    render(
      <div>
        <TextField label="Text event" value="a" onValueChange={onText} />
        <Select
          label="Select event"
          onValueChange={onSelect}
          options={[
            { value: "one", label: "One" },
            { value: "disabled", label: "Disabled", disabled: true },
            { value: "two", label: "Two", searchText: "vision" },
          ]}
          searchPlaceholder="Search options"
          value="one"
        />
        <Switch
          checked={false}
          label="Switch event"
          onCheckedChange={onChecked}
        />
      </div>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Text event" }), {
      target: { value: "ab" },
    });
    expect(onText).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Select event One" }));
    const search = screen.getByRole("combobox", { name: "Search options" });
    fireEvent.change(search, { target: { value: "vision" } });
    fireEvent.compositionStart(search);
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.compositionEnd(search);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("two");
    await user.click(screen.getByRole("switch", { name: "Switch event" }));
    expect(onChecked).toHaveBeenCalledOnce();
    expect(onChecked).toHaveBeenCalledWith(true);
  },

  "form-semantics"() {
    const { container } = render(
      <div dir="rtl">
        <SearchField
          label="Archive search"
          value=""
          onValueChange={() => undefined}
        />
        <TextField
          description="Description"
          error="Error"
          label="Described field"
          value="bad"
          onValueChange={() => undefined}
        />
        <Checkbox error="Required" label="Capability" />
        <Switch label="Enabled" defaultChecked />
      </div>,
    );
    const search = screen.getByRole("searchbox", { name: "Archive search" });
    const described = screen.getByRole("textbox", { name: "Described field" });
    expect(search.getAttribute("type")).toBe("search");
    expect(search.closest('[dir="rtl"]')).not.toBeNull();
    expect(described.getAttribute("aria-describedby")?.split(" ")).toHaveLength(
      2,
    );
    expect(described.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Capability" })).not.toBeNull();
    expect(screen.getByRole("switch", { name: "Enabled" })).not.toBeNull();
    expect(
      container.querySelector(
        '[data-label-visibility="hidden"] [data-part="label"]',
      ),
    ).not.toBeNull();
  },
} satisfies Record<ConformanceCase, () => void | Promise<void>>;

const conformanceCases = conformanceMatrix.skins.default as ConformanceCase[];
const skinCaseMatrix = (["default", "stress"] as const).flatMap((skin) =>
  conformanceCases.map((caseName) => ({ skin, caseName })),
);

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
      const afterSwitch = screen.getByRole("textbox", {
        name: "Synthetic value",
      });
      expect(afterSwitch).toBe(probeControl);
      expect(afterSwitch).toHaveProperty("value", "preserve-changed");
      const afterFormControl = screen.getByRole("textbox", {
        name: "Controlled text",
      });
      expect(afterFormControl).toBe(formControl);
      expect(afterFormControl).toHaveProperty(
        "value",
        "Editable value-changed",
      );
      expect(afterFormControl).toHaveProperty("selectionStart", 2);
      expect(afterFormControl).toHaveProperty("selectionEnd", 5);
      expect(document.activeElement).toBe(afterFormControl);
      expect(modelTrigger?.textContent).toContain(
        "Beta · vision and long context",
      );
      expect(
        (
          screen.getByRole("checkbox", {
            name: "Controlled checkbox",
          }) as HTMLInputElement
        ).checked,
      ).toBe(false);
      expect(
        (
          screen.getByRole("switch", {
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
      const afterPrimaryAction = screen.getByRole("button", {
        name: "compact primary",
      });
      const afterActionStatus = screen
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
  }, 20_000);

  it("binds every declared matrix case to a real behavior runner", () => {
    expect(conformanceMatrix.skins.stress).toEqual(
      conformanceMatrix.skins.default,
    );
    expect(Object.keys(caseRunners).sort()).toEqual(
      [...conformanceMatrix.skins.default].sort(),
    );
    expect(skinCaseMatrix).toHaveLength(36);
  });

  it.each(skinCaseMatrix)(
    "$caseName behavior passes under the $skin skin",
    async ({ skin, caseName }) => {
      prepareSkin(skin);
      await caseRunners[caseName]();
    },
  );
});
