import { useLayoutEffect, useRef, useState } from "react";

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
import {
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  Popover,
  Toast,
  ToastViewport,
  Tooltip,
} from "@artemis/ui/feedback";
import {
  ListRow,
  PanelHeader,
  ScrollArea,
  SplitPane,
  Toolbar,
} from "@artemis/ui/layout";
import { SegmentedControl, Tabs } from "@artemis/ui/navigation";
import {
  AgentActivity,
  AgentTeamSummary,
  ApprovalCard,
  ContextUsage,
  ResultDisclosure,
  RunModeControl,
  TaskPlan,
  ToolActivity,
  TurnStatus,
  UserInput,
} from "@artemis/ui/patterns";

import { galleryContract } from "./gallery-contract.js";
import { ConversationGallery } from "./conversation-gallery.js";
import { GalleryActionIcon } from "./gallery-action-icon.js";
import { ProfessionalGallery } from "./professional-gallery.js";
import { STRESS_SKIN_ID, stressSkinCss } from "./stress-skin-fixture.mjs";
import { WorkspaceGallery } from "./workspace-gallery.js";
import { WorkflowGallery } from "./workflow-gallery.js";

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
const ACTIVITY_TAB_OPTIONS = [
  {
    id: "gallery-overview-tab",
    label: "Overview",
    panelId: "gallery-overview-panel",
    value: "overview",
  },
  {
    disabled: true,
    id: "gallery-export-tab",
    label: "Unavailable export",
    panelId: "gallery-export-panel",
    value: "export",
  },
  {
    id: "gallery-details-tab",
    label: "A very long localized activity comparison",
    panelId: "gallery-details-panel",
    value: "details",
  },
] as const;
const RTL_TAB_OPTIONS = [
  {
    id: "gallery-rtl-first-tab",
    label: "First",
    panelId: "gallery-rtl-first-panel",
    value: "first",
  },
  {
    id: "gallery-rtl-second-tab",
    label: "Second",
    panelId: "gallery-rtl-second-panel",
    value: "second",
  },
] as const;
const DISABLED_TAB_OPTIONS = [
  {
    id: "gallery-disabled-tab",
    label: "Selected but disabled",
    panelId: "gallery-disabled-panel",
    value: "fixed",
  },
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
  const [tabValue, setTabValue] = useState<"overview" | "export" | "details">(
    "overview",
  );
  const [rtlTabValue, setRtlTabValue] = useState<"first" | "second">("second");
  const [segmentValue, setSegmentValue] = useState<"rich" | "source">("rich");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [splitSize, setSplitSize] = useState(240);
  const [patternMode, setPatternMode] = useState<"plan" | "execute">("plan");
  const [patternOption, setPatternOption] = useState("review");
  const popoverAnchorRef = useRef<HTMLButtonElement>(null);
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
      <p className="gallery-eyebrow">CL4 agent pattern conformance</p>
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
        aria-labelledby="pattern-heading"
      >
        <h2 id="pattern-heading">Agent patterns and state ownership</h2>
        <p>
          Copy, formatted values, action order, and policy stay caller-owned;
          the UI package supplies stable anatomy and interaction affordances.
        </p>
        <div className="gallery-pattern-grid">
          <RunModeControl
            label="Gallery run mode"
            onValueChange={setPatternMode}
            options={[
              {
                description: "Inspect without changing files",
                label: "Plan",
                value: "plan",
              },
              {
                description: "Apply the approved change",
                label: "Execute",
                value: "execute",
              },
            ]}
            statusLabel="Ready"
            value={patternMode}
          />
          <RunModeControl
            label="Disabled run mode"
            onValueChange={() => undefined}
            options={[
              {
                label: "Review",
                value: "review",
              },
            ]}
            state="disabled"
            statusLabel="Unavailable"
            value="review"
          />
          <ApprovalCard
            actions={
              <>
                <button type="button">Deny</button>
                <button type="button">Approve project</button>
                <button type="button">Approve once</button>
              </>
            }
            description="npm test"
            label="Run the complete test suite"
            reason="This explanation is formatted by the consumer."
            state="pending"
            statusLabel="Pending"
            title="Run the complete test suite"
          />
          <ApprovalCard
            actions={<button type="button">View audit trail</button>}
            label="Resolved approval"
            state="approved"
            statusLabel="Approved"
            title="Read project files"
          />
          <ApprovalCard
            actions={<button type="button">Dismiss</button>}
            label="Approval error"
            state="error"
            statusLabel="Error"
            title="Approval service is unavailable"
          />
          <ToolActivity
            collapseLabel="Collapse"
            defaultExpanded
            expandLabel="Expand"
            label="Read project files"
            state="stale"
            statusLabel="Stale"
            summary="Read a very long localized set of project files without truncating the accessible name"
          >
            <p>
              Caller-formatted file activity remains visible after expansion.
            </p>
          </ToolActivity>
          <TaskPlan
            collapseLabel="Collapse"
            currentStepId="implement"
            defaultExpanded
            expandLabel="Expand"
            label="Step 2 of 3"
            progressLabel="Step 2 of 3"
            state="active"
            statusLabel="In progress"
            steps={[
              {
                id: "inspect",
                label: "Inspect the current implementation",
                status: "completed",
                statusLabel: "Completed",
              },
              {
                id: "implement",
                label: "Implement the public pattern boundary",
                status: "pending",
                statusLabel: "In progress",
              },
              {
                id: "verify",
                label: "Verify consumer behavior",
                status: "pending",
                statusLabel: "Not started",
              },
            ]}
            stepsLabel="Gallery task steps"
          />
          <ContextUsage
            detail="7,250 of 10,000 tokens"
            label="Context usage"
            percent={72.5}
            state="timeout"
            statusLabel="Timed out"
            valueLabel="72.5%"
          />
          <div dir="rtl">
            <UserInput
              actions={<button type="button">Submit answer</button>}
              description="تظل البيانات والسياسة لدى التطبيق المستهلك"
              label="RTL user input"
              onOptionSelect={setPatternOption}
              options={[
                {
                  id: "review",
                  label: "مراجعة التغييرات قبل المتابعة",
                },
                {
                  id: "continue",
                  label: "المتابعة مباشرة",
                },
              ]}
              question="كيف تريد المتابعة؟"
              selectedOptionId={patternOption}
              state="pending"
              statusLabel="بانتظار الإجابة"
            />
          </div>
          <UserInput
            label="Timed out input"
            onOptionSelect={() => undefined}
            options={[
              {
                id: "fixed",
                label: "No longer available",
              },
            ]}
            question="This request timed out"
            state="timeout"
            statusLabel="Timed out"
          />
          <AgentActivity
            description="Waiting for a caller-owned dependency"
            label="Agent activity"
            state="failed"
            statusLabel="Failed"
            title="Validate package"
          />
          <AgentTeamSummary
            label="Agent team summary"
            members={[
              {
                id: "one",
                label: "Validator",
                state: "completed",
                statusLabel: "Completed",
              },
              {
                id: "two",
                label: "Reviewer",
                state: "waiting",
                statusLabel: "Waiting",
              },
            ]}
            state="active"
            statusLabel="1 of 2 complete"
            title="Migration review"
          />
          <TurnStatus
            durationLabel="00:42"
            label="Current turn"
            state="running"
            statusLabel="Working"
          />
          <ResultDisclosure
            collapseLabel="Collapse"
            defaultExpanded
            expandLabel="Expand"
            label="Validation result"
            state="completed"
            statusLabel="Completed"
            summary="Validation result"
          >
            All caller-selected checks passed.
          </ResultDisclosure>
        </div>
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="conversation-heading"
      >
        <h2 id="conversation-heading">Conversation and trusted-AI states</h2>
        <p>
          Timeline content, scroll state, actions, and runtime data stay
          caller-owned while public components provide stable visual anatomy.
        </p>
        <ConversationGallery />
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="workspace-heading"
      >
        <h2 id="workspace-heading">Workspace dock, tabs, and files</h2>
        <p>
          Dock geometry, tab focus, editor states, and file presentation use
          public UI anatomy while data and persistence remain caller-owned.
        </p>
        <WorkspaceGallery />
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="workflow-heading"
      >
        <h2 id="workflow-heading">Review, Environment, Goal, and Sources</h2>
        <p>
          Workflow presentation and finite visual states use public UI anatomy;
          callers retain data, permissions, persistence, and runtime effects.
        </p>
        <WorkflowGallery />
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="professional-heading"
      >
        <h2 id="professional-heading">Terminal and Browser shells</h2>
        <p>
          Public presentation keeps technical content readable and responsive;
          callers retain PTY, webview, navigation, session, and security
          effects.
        </p>
        <ProfessionalGallery />
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="feedback-layout-heading"
      >
        <h2 id="feedback-layout-heading">Feedback, overlays, and layout</h2>
        <Toolbar
          actions={
            <>
              <Tooltip label="Open the project action menu">
                <button
                  aria-expanded={popoverOpen}
                  onClick={() => setPopoverOpen((value) => !value)}
                  ref={popoverAnchorRef}
                  type="button"
                >
                  Actions
                </button>
              </Tooltip>
              <button onClick={() => setConfirmationOpen(true)} type="button">
                Confirm
              </button>
            </>
          }
          label="Feedback examples"
          title="Project activity"
        >
          Controlled overlays and caller-owned state
        </Toolbar>
        <Popover
          anchorRef={popoverAnchorRef}
          label="Project actions"
          onOpenChange={setPopoverOpen}
          open={popoverOpen}
          role="menu"
        >
          <button
            onClick={() => setPopoverOpen(false)}
            role="menuitem"
            type="button"
          >
            Archive project
          </button>
        </Popover>
        <ConfirmationDialog
          actions={
            <>
              <button onClick={() => setConfirmationOpen(false)} type="button">
                Cancel
              </button>
              <button onClick={() => setConfirmationOpen(false)} type="button">
                Continue
              </button>
            </>
          }
          description="This sample verifies native modal focus, Escape, and focus return."
          label="Continue migration"
          onOpenChange={setConfirmationOpen}
          open={confirmationOpen}
          title="Continue migration?"
          tone="warning"
        />
        <div className="gallery-feedback-grid">
          <InlineNotice title="Connected" tone="success">
            The local provider is ready.
          </InlineNotice>
          <InlineNotice title="Review required" tone="warning">
            One approval is still pending.
          </InlineNotice>
          <Toast tone="info">Background validation completed.</Toast>
          <ErrorState title="Could not load activity">
            Try again later.
          </ErrorState>
          <EmptyState
            description="Create a task to populate this panel."
            title="No recent tasks"
          />
          <LoadingState label="Loading resources" />
        </div>
        <button onClick={() => setToastVisible(true)} type="button">
          Show portal toast
        </button>
        {toastVisible ? (
          <ToastViewport label="Gallery notifications">
            <Toast
              dismissLabel="Dismiss"
              onDismiss={() => setToastVisible(false)}
              tone="success"
            >
              Gallery state preserved.
            </Toast>
          </ToastViewport>
        ) : null}
        <div className="gallery-split-sample">
          <SplitPane
            label="Resize activity navigation"
            maximumSize={360}
            minimumSize={160}
            onSizeChange={setSplitSize}
            primary={
              <ScrollArea label="Activity navigation">
                <div role="listbox" aria-label="Activity views">
                  <ListRow label="Overview" selected />
                  <ListRow description="Three unread events" label="Timeline" />
                  <ListRow disabled label="Audit export" />
                </div>
              </ScrollArea>
            }
            secondary={
              <>
                <PanelHeader
                  description="Resize with pointer, arrows, Home, or End"
                  headingLevel={3}
                  title="Activity detail"
                />
                <ScrollArea label="Activity detail">
                  <p className="gallery-split-copy">
                    The separator remains caller-controlled and mirrors logical
                    direction in RTL.
                  </p>
                </ScrollArea>
              </>
            }
            size={splitSize}
          />
        </div>
      </section>

      <section
        className="gallery-sample-section"
        aria-labelledby="navigation-heading"
      >
        <h2 id="navigation-heading">Tabs and segmented controls</h2>
        <div className="gallery-navigation-grid">
          <div>
            <Tabs
              label="Activity views"
              onValueChange={setTabValue}
              options={ACTIVITY_TAB_OPTIONS}
              value={tabValue}
            />
            {ACTIVITY_TAB_OPTIONS.map((option) => (
              <p
                aria-labelledby={option.id}
                hidden={option.value !== tabValue}
                id={option.panelId}
                key={option.value}
                role="tabpanel"
              >
                {option.value === "overview"
                  ? "Overview panel remains selected across Gallery axes."
                  : option.value === "details"
                    ? "Detailed comparison panel remains selected across Gallery axes."
                    : "Export remains unavailable."}
              </p>
            ))}
          </div>
          <div dir="rtl">
            <Tabs
              label="RTL compact tabs"
              onValueChange={setRtlTabValue}
              options={RTL_TAB_OPTIONS}
              size="compact"
              value={rtlTabValue}
            />
            {RTL_TAB_OPTIONS.map((option) => (
              <p
                aria-labelledby={option.id}
                hidden={option.value !== rtlTabValue}
                id={option.panelId}
                key={option.value}
                role="tabpanel"
              >
                {option.label} RTL panel.
              </p>
            ))}
          </div>
          <div>
            <Tabs
              disabled
              label="Disabled tabs"
              options={DISABLED_TAB_OPTIONS}
              value="fixed"
              onValueChange={() => undefined}
            />
            <p
              aria-labelledby="gallery-disabled-tab"
              id="gallery-disabled-panel"
              role="tabpanel"
            >
              Disabled selection panel.
            </p>
          </div>
          <SegmentedControl
            label="Markdown view"
            onValueChange={setSegmentValue}
            options={[
              { label: "Rich", value: "rich" },
              { label: "Source", value: "source" },
            ]}
            value={segmentValue}
          />
          <div dir="rtl">
            <SegmentedControl
              defaultValue="preview"
              label="RTL compact display"
              options={[
                { label: "Edit", value: "edit" },
                { label: "Preview", value: "preview" },
                { disabled: true, label: "Diff unavailable", value: "diff" },
              ]}
              size="compact"
            />
          </div>
          <SegmentedControl
            disabled
            label="Disabled display"
            options={[{ label: "Fixed", value: "fixed" }]}
            value="fixed"
            onValueChange={() => undefined}
          />
        </div>
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
