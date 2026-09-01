import { useLayoutEffect, useState } from "react";

import { artemisThemeManifest } from "@artemis/theme-artemis";
import {
  SEMANTIC_TOKEN_REGISTRY,
  type ContrastMode,
  type ThemeMode,
} from "@artemis/theme-contract";
import { Badge, Button, Icon, IconButton, Status } from "@artemis/ui/actions";
import { ConformanceProbe } from "@artemis/ui/conformance";
import {
  Checkbox,
  SearchField,
  Select,
  Switch,
  TextField,
} from "@artemis/ui/forms";

import { galleryContract } from "./gallery-contract.js";
import { STRESS_SKIN_ID, stressSkinCss } from "./stress-skin-fixture.mjs";

export type GallerySkin = "default" | "stress";

export interface GalleryMode {
  readonly skin: GallerySkin;
  readonly theme: ThemeMode;
  readonly contrast: ContrastMode;
}

export const GALLERY_TOKEN_PROVENANCE =
  "@artemis/theme-artemis/theme.css" as const;

type GalleryTokenName = keyof typeof SEMANTIC_TOKEN_REGISTRY;
const TOKEN_SAMPLE_NAMES = Object.freeze(
  Object.keys(SEMANTIC_TOKEN_REGISTRY) as GalleryTokenName[],
);
export type GalleryTokenSnapshot = Readonly<Record<GalleryTokenName, string>>;

const SURFACE_SAMPLES = [
  ["base", "Base"],
  ["raised", "Raised"],
  ["sunken", "Sunken"],
  ["composer", "Composer"],
  ["user", "User"],
] as const;

const RADIUS_SAMPLES = [
  ["control", "Control"],
  ["input", "Input"],
  ["card", "Card"],
  ["panel", "Panel"],
  ["composer", "Composer"],
] as const;

const THEME_OPTIONS = [
  ["light", "Light"],
  ["dark", "Dark"],
] as const;
const CONTRAST_OPTIONS = [
  ["normal", "Normal"],
  ["high", "High"],
] as const;
const SKIN_OPTIONS = [
  ["default", "Direction A"],
  ["stress", "Stress"],
] as const;
const ACTION_CONTROL_SIZES = ["compact", "comfortable"] as const;
const BUTTON_VARIANTS = ["primary", "secondary", "quiet", "danger"] as const;
const ICON_BUTTON_VARIANTS = ["secondary", "quiet", "danger"] as const;
const ACTION_STATES = [
  ["ready", {}],
  ["selected", { selected: true }],
  ["error", { error: true }],
  ["loading", { loading: true }],
  ["disabled", { disabled: true }],
] as const;
const ACTION_TONES = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
] as const;

function blankTokenSnapshot(): GalleryTokenSnapshot {
  return Object.fromEntries(
    TOKEN_SAMPLE_NAMES.map((name) => [name, ""]),
  ) as unknown as GalleryTokenSnapshot;
}

export function readGalleryTokenSnapshot(): GalleryTokenSnapshot {
  if (typeof getComputedStyle !== "function") return blankTokenSnapshot();
  const computed = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    TOKEN_SAMPLE_NAMES.map((name) => [
      name,
      computed
        .getPropertyValue(SEMANTIC_TOKEN_REGISTRY[name].cssVariable)
        .trim(),
    ]),
  ) as unknown as GalleryTokenSnapshot;
}

export function applyGalleryMode(mode: GalleryMode): void {
  document.documentElement.dataset.artemisSkin =
    mode.skin === "default" ? artemisThemeManifest.id : STRESS_SKIN_ID;
  document.documentElement.dataset.artemisTheme = mode.theme;
  document.documentElement.dataset.artemisContrast = mode.contrast;
}

export function applyGallerySkin(skin: GallerySkin): void {
  applyGalleryMode({ skin, theme: "light", contrast: "normal" });
}

export function installGalleryStressSkinStyles(): void {
  if (document.head.querySelector("style[data-gallery-stress-skin]") !== null) {
    return;
  }
  const style = document.createElement("style");
  style.dataset.galleryStressSkin = "";
  style.textContent = stressSkinCss;
  document.head.append(style);
}

function currentGalleryMode(): GalleryMode {
  return {
    skin:
      document.documentElement.dataset.artemisSkin === STRESS_SKIN_ID
        ? "stress"
        : "default",
    theme:
      document.documentElement.dataset.artemisTheme === "dark"
        ? "dark"
        : "light",
    contrast:
      document.documentElement.dataset.artemisContrast === "high"
        ? "high"
        : "normal",
  };
}

function preserveProbeFocus(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function GalleryActionIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M2 8h12M8 2v12" stroke="currentColor" />
    </svg>
  );
}

interface GalleryAxisControlProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly (readonly [T, string])[];
  readonly onChange: (value: T) => void;
}

function GalleryAxisControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: GalleryAxisControlProps<T>) {
  return (
    <fieldset className="gallery-axis-control">
      <legend>{label}</legend>
      {options.map(([option, optionLabel]) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onMouseDown={preserveProbeFocus}
          onClick={() => onChange(option)}
        >
          {optionLabel}
        </button>
      ))}
    </fieldset>
  );
}

export function GalleryApp() {
  const [mode, setMode] = useState<GalleryMode>(currentGalleryMode);
  const [tokenSnapshot, setTokenSnapshot] =
    useState<GalleryTokenSnapshot>(blankTokenSnapshot);
  const [eventOrder, setEventOrder] = useState<readonly string[]>([]);
  const [fieldValue, setFieldValue] = useState("Editable value");
  const [searchValue, setSearchValue] = useState("");
  const [selectValue, setSelectValue] = useState("alpha");
  const [checked, setChecked] = useState(true);
  const appendEvent = (entry: string) =>
    setEventOrder((current) => [...current, entry]);

  useLayoutEffect(() => {
    setTokenSnapshot(readGalleryTokenSnapshot());
  }, [mode]);

  const changeMode = (nextMode: GalleryMode) => {
    if (nextMode.skin === "stress") installGalleryStressSkinStyles();
    applyGalleryMode(nextMode);
    setMode(nextMode);
  };

  return (
    <main>
      <p className="gallery-eyebrow">CL2B field and selection conformance</p>
      <h1>Artemis UI Gallery</h1>
      <p>
        Public package consumption is active for UI contract v
        {galleryContract.uiContractVersion} and skin {galleryContract.skinId}.
      </p>
      <div className="gallery-axis-grid" aria-label="Gallery mode controls">
        <GalleryAxisControl
          label="Skin"
          value={mode.skin}
          options={SKIN_OPTIONS}
          onChange={(skin) => changeMode({ ...mode, skin })}
        />
        <GalleryAxisControl
          label="Theme"
          value={mode.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => changeMode({ ...mode, theme })}
        />
        <GalleryAxisControl
          label="Contrast"
          value={mode.contrast}
          options={CONTRAST_OPTIONS}
          onChange={(contrast) => changeMode({ ...mode, contrast })}
        />
      </div>
      <p
        aria-live="polite"
        data-gallery-active-skin={mode.skin}
        data-gallery-active-theme={mode.theme}
        data-gallery-active-contrast={mode.contrast}
      >
        Active mode: {mode.skin} / {mode.theme} / {mode.contrast}
      </p>

      <section
        className="gallery-sample-section"
        aria-labelledby="token-heading"
      >
        <h2 id="token-heading">Resolved token output</h2>
        <p data-gallery-token-provenance={GALLERY_TOKEN_PROVENANCE}>
          Computed from {GALLERY_TOKEN_PROVENANCE}; no Gallery palette copy.
        </p>
        <dl className="gallery-token-grid">
          {TOKEN_SAMPLE_NAMES.map((name) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>
                <output data-gallery-token={name}>
                  {tokenSnapshot[name] || "unresolved"}
                </output>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="form-heading"
      >
        <h2 id="form-heading">Fields, selection, checkbox, and switch</h2>
        <div className="gallery-form-grid">
          <TextField
            label="Controlled text"
            onValueChange={setFieldValue}
            value={fieldValue}
          />
          <TextField
            description="Long descriptions wrap without changing anatomy."
            label="Compact email"
            placeholder="person@example.com"
            size="compact"
            type="email"
          />
          <TextField
            error="A visible error is also programmatically described."
            label="Invalid URL"
            type="url"
            value="not a URL"
            onValueChange={() => undefined}
          />
          <TextField
            label="Read-only password"
            readOnly
            type="password"
            value="preserved"
            onValueChange={() => undefined}
          />
          <TextField
            disabled
            label="Disabled number"
            type="number"
            value="42"
            onValueChange={() => undefined}
          />
          <SearchField
            label="Search components"
            onValueChange={setSearchValue}
            placeholder="Search a long localized component name"
            size="comfortable"
            value={searchValue}
          />
          <SearchField
            label="Compact search"
            placeholder="Compact component search"
            size="compact"
          />
          <Select
            label="Model"
            onValueChange={setSelectValue}
            options={[
              { value: "alpha", label: "Alpha · general purpose" },
              { value: "blocked", label: "Unavailable option", disabled: true },
              { value: "beta", label: "Beta · vision and long context" },
            ]}
            searchPlaceholder="Search models"
            value={selectValue}
          />
          <Select
            disabled
            label="Disabled selection"
            onValueChange={() => undefined}
            options={[{ value: "fixed", label: "Fixed" }]}
            size="compact"
            value="fixed"
          />
          <Select
            error="Choose a supported value"
            label="Invalid selection"
            onValueChange={() => undefined}
            options={[{ value: "unknown", label: "Unknown" }]}
            value="unknown"
          />
        </div>
        <div className="gallery-check-grid" dir="rtl">
          <Checkbox
            checked={checked}
            label="Controlled checkbox"
            onCheckedChange={setChecked}
            size="comfortable"
          />
          <Checkbox error="Required choice" label="Error checkbox" />
          <Checkbox disabled label="Disabled checkbox" />
          <Switch
            checked={checked}
            label="Controlled switch"
            onCheckedChange={setChecked}
            size="comfortable"
          />
          <Switch error="Connection unavailable" label="Error switch" />
          <Switch disabled label="Disabled switch" />
        </div>
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="action-heading"
      >
        <h2 id="action-heading">Action, icon, badge, and status</h2>
        <div className="gallery-surface-grid">
          {ACTION_CONTROL_SIZES.flatMap((size) =>
            BUTTON_VARIANTS.map((variant) => (
              <Button
                key={`${size}-${variant}`}
                icon={<GalleryActionIcon />}
                size={size}
                variant={variant}
              >
                {`${size} ${variant}`}
              </Button>
            )),
          )}
          {ACTION_CONTROL_SIZES.flatMap((size) =>
            ACTION_STATES.map(([state, stateProps]) => (
              <Button key={`${size}-${state}`} size={size} {...stateProps}>
                {`${size} ${state}`}
              </Button>
            )),
          )}
        </div>
        <div className="gallery-surface-grid">
          {ACTION_CONTROL_SIZES.flatMap((size) =>
            ICON_BUTTON_VARIANTS.flatMap((variant) =>
              ACTION_STATES.map(([state, stateProps]) => {
                const label = `${size} ${variant} ${state} icon action`;
                return (
                  <IconButton
                    key={label}
                    icon={<GalleryActionIcon />}
                    label={label}
                    size={size}
                    title={label}
                    variant={variant}
                    {...stateProps}
                  />
                );
              }),
            ),
          )}
        </div>
        <div className="gallery-surface-grid">
          {(["xs", "sm", "base", "lg", "xl"] as const).map((size) => (
            <Icon key={size} size={size}>
              <GalleryActionIcon />
            </Icon>
          ))}
          {ACTION_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {`${tone} badge`}
            </Badge>
          ))}
          {ACTION_TONES.map((tone) => (
            <Status
              key={tone}
              live={tone === "info" ? "polite" : undefined}
              tone={tone}
            >
              {tone === "info" ? "2.5K / 10K" : `${tone} status`}
            </Status>
          ))}
        </div>
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="surface-heading"
      >
        <h2 id="surface-heading">Surface and type samples</h2>
        <div className="gallery-surface-grid">
          {SURFACE_SAMPLES.map(([surface, label]) => (
            <div
              key={surface}
              className={`gallery-surface-sample gallery-surface-${surface}`}
            >
              {label}
            </div>
          ))}
        </div>
        <div className="gallery-type-sample">
          <p className="gallery-type-primary">Primary body text</p>
          <p className="gallery-type-secondary">Secondary supporting text</p>
          <p className="gallery-type-tertiary">Tertiary metadata text</p>
        </div>
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="geometry-heading"
      >
        <h2 id="geometry-heading">Radius and motion samples</h2>
        <div className="gallery-radius-grid">
          {RADIUS_SAMPLES.map(([radius, label]) => (
            <div
              key={radius}
              className={`gallery-radius-sample gallery-radius-${radius}`}
            >
              {label}
            </div>
          ))}
        </div>
        <div className="gallery-motion-sample">
          <span className="gallery-motion-swatch" aria-hidden="true" />
          180 / 320 / 480ms · standard and shell easing
        </div>
      </section>

      <section
        className="gallery-probe-section"
        aria-labelledby="probe-heading"
      >
        <h2 id="probe-heading">ConformanceProbe</h2>
        <ConformanceProbe
          id="gallery-probe"
          label="Synthetic value"
          description="State must survive skin, theme, and contrast switches."
          defaultValue="preserve"
          onValueChange={(value) => appendEvent(`change:${value}`)}
          onCommit={(value) => appendEvent(`commit:${value}`)}
          onEvent={(event) => appendEvent(`event:${event.type}:${event.value}`)}
        />
        <output data-gallery-event-order>{eventOrder.join("|")}</output>
      </section>
    </main>
  );
}
