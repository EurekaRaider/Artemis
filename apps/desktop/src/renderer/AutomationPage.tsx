import { isExecutionMode } from "@artemis/protocol";
import { statusText } from "../shared/status-text.js";
import { makeUiCopy, uiText } from "../shared/ui-text.js";
import { UI_COPY } from "../shared/ui-copy.js";
import { I18N_RESOURCES } from "../shared/i18n-resources.js";
import type { SettingsSnapshot } from "../shared/api.js";
import {
  selectionForModelSwitch,
  thinkingLevelLabel,
  thinkingLevelsForModel,
} from "./model-selection.js";
import automationHeaderIcon from "./assets/automation-header-icon.png";
import { Temporal } from "@js-temporal/polyfill";
import {
  createAutomationViewState,
  reduceAutomationEvent,
  type Automation,
  type AutomationSchedule,
  type AutomationTarget,
  type AppLocale,
  type AutomationViewState,
  type ModelSelection,
  type Project,
  type RunMode,
} from "@artemis/protocol";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button, IconButton, Status } from "@artemis/ui/actions";
import { DataSurface } from "@artemis/ui/data";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  Dialog,
  EmptyState,
  ErrorState,
  InlineNotice,
  Popover,
} from "@artemis/ui/feedback";
import { Checkbox, Select, TextAreaField, TextField } from "@artemis/ui/forms";
import { ManagementCard, ManagementHeader } from "@artemis/ui/management";

type Locale = AppLocale;
type SchedulePreset =
  "once" | "interval" | "windowed-interval" | "daily" | "weekdays" | "weekly";
type IntervalUnit = Extract<AutomationSchedule, { kind: "interval" }>["unit"];
type WindowedIntervalUnit = Extract<
  AutomationSchedule,
  { kind: "windowed-interval" }
>["unit"];

interface AutomationDraft {
  id?: string;
  projectId: string;
  name: string;
  prompt: string;
  mode: RunMode;
  target: AutomationTarget;
  preset: SchedulePreset;
  date: string;
  time: string;
  timeZone: string;
  daysOfWeek: number[];
  intervalEvery: number;
  intervalUnit: IntervalUnit;
  windowStart: string;
  windowEnd: string;
  windowIntervalUnit: WindowedIntervalUnit;
  enabled: boolean;
  modelSelection?: ModelSelection | undefined;
}

const text = UI_COPY.AutomationPage_text;

function normalizedOptionLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]+/gu, "")
    .replace(/\p{White_Space}+/gu, " ")
    .trim()
    .toLowerCase();
}

function projectSelectOptions(
  projects: readonly Project[],
  reservedLabels: readonly string[] = [],
): Array<{ label: string; value: string }> {
  const nameCounts = new Map<string, number>();
  for (const project of projects) {
    const key = normalizedOptionLabel(project.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const usedLabels = new Set(reservedLabels.map(normalizedOptionLabel));
  return projects.map((project) => {
    const nameKey = normalizedOptionLabel(project.name);
    let label =
      (nameCounts.get(nameKey) ?? 0) > 1 || usedLabels.has(nameKey)
        ? `${project.name} — ${project.path}`
        : project.name;
    if (usedLabels.has(normalizedOptionLabel(label))) {
      label = `${label} — ${project.id}`;
    }
    usedLabels.add(normalizedOptionLabel(label));
    return { label, value: project.id };
  });
}

const weekLabels = makeUiCopy((locale) =>
  Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(locale, {
      weekday: locale.startsWith("zh") ? "narrow" : "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2024, 0, day + 1))),
  ),
);

const timeHours = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0"),
);
const timeMinutes = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);

function TimeOptions(props: {
  autoFocus?: boolean;
  labelId: string;
  onChange(value: string): void;
  onCommit?(): void;
  value: string;
  values: string[];
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, props.values.indexOf(props.value));

  const centerOption = (index: number, focus = false) => {
    const option = optionRefs.current[index];
    const list = option?.parentElement;
    if (focus) option?.focus({ preventScroll: true });
    if (option && list) {
      list.scrollTop =
        option.offsetTop - list.clientHeight / 2 + option.offsetHeight / 2;
    }
  };

  useEffect(() => {
    centerOption(selectedIndex, props.autoFocus);
  }, [props.autoFocus]);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = (index + 1) % props.values.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = (index - 1 + props.values.length) % props.values.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = props.values.length - 1;
    }
    if (nextIndex === undefined) return;
    const nextValue = props.values[nextIndex];
    if (nextValue === undefined) return;
    event.preventDefault();
    props.onChange(nextValue);
    window.requestAnimationFrame(() => centerOption(nextIndex, true));
  };

  return (
    <div
      aria-labelledby={props.labelId}
      className="automation-time-list"
      role="listbox"
    >
      {props.values.map((option, index) => (
        <button
          aria-selected={option === props.value}
          className={`automation-time-option ${
            option === props.value ? "selected" : ""
          }`}
          key={option}
          onClick={() => {
            props.onChange(option);
            props.onCommit?.();
          }}
          onKeyDown={(event) => navigate(event, index)}
          ref={(element) => {
            optionRefs.current[index] = element;
          }}
          role="option"
          tabIndex={option === props.value ? 0 : -1}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function TimePicker(props: {
  hourLabel: string;
  label: string;
  minuteLabel: string;
  onChange(value: string): void;
  value: string;
}) {
  const [selectedHour = "00", selectedMinute = "00"] = props.value.split(":");
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const hourLabelId = useId();
  const minuteLabelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() =>
        trigger.current?.focus({ preventScroll: true }),
      );
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const closeAndFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  };

  return (
    <div className={`automation-time-picker ${open ? "open" : ""}`} ref={root}>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${props.label}: ${props.value}`}
        className="automation-time-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
        type="button"
      >
        <ArtemisIcon
          className="automation-time-clock"
          height={16}
          name="clock"
          width={16}
        />
        <span className="automation-time-value">
          <span>{selectedHour}</span>
          <span aria-hidden="true" className="automation-time-colon">
            :
          </span>
          <span>{selectedMinute}</span>
        </span>
        <ArtemisIcon
          className="automation-time-chevron"
          height={16}
          name="chevron"
          width={16}
        />
      </button>
      {open && (
        <div
          aria-label={props.label}
          className="automation-time-popover"
          id={popoverId}
          role="dialog"
        >
          <div className="automation-time-column">
            <span className="automation-time-heading" id={hourLabelId}>
              {props.hourLabel}
            </span>
            <TimeOptions
              autoFocus
              labelId={hourLabelId}
              onChange={(hour) => props.onChange(`${hour}:${selectedMinute}`)}
              value={selectedHour}
              values={timeHours}
            />
          </div>
          <div aria-hidden="true" className="automation-time-divider" />
          <div className="automation-time-column">
            <span className="automation-time-heading" id={minuteLabelId}>
              {props.minuteLabel}
            </span>
            <TimeOptions
              labelId={minuteLabelId}
              onChange={(minute) => props.onChange(`${selectedHour}:${minute}`)}
              onCommit={closeAndFocus}
              value={selectedMinute}
              values={timeMinutes}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function defaultDraft(projectId: string): AutomationDraft {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const tomorrow = Temporal.Now.instant()
    .toZonedDateTimeISO(timeZone)
    .add({ days: 1 });
  return {
    projectId,
    name: "",
    prompt: "",
    mode: "plan",
    target: "local",
    preset: "daily",
    date: tomorrow.toPlainDate().toString(),
    time: "09:00",
    timeZone,
    daysOfWeek: [1],
    intervalEvery: 30,
    intervalUnit: "minutes",
    windowStart: "09:00",
    windowEnd: "18:00",
    windowIntervalUnit: "minutes",
    enabled: true,
  };
}

function scheduleForDraft(draft: AutomationDraft): AutomationSchedule {
  if (draft.preset === "interval") {
    return {
      kind: "interval",
      every: draft.intervalEvery,
      unit: draft.intervalUnit,
    };
  }
  if (draft.preset === "windowed-interval") {
    return {
      kind: "windowed-interval",
      every: draft.intervalEvery,
      unit: draft.windowIntervalUnit,
      startTime: draft.windowStart,
      endTime: draft.windowEnd,
      daysOfWeek: draft.daysOfWeek,
      timeZone: draft.timeZone,
    };
  }
  if (draft.preset === "once") {
    const instant = Temporal.PlainDateTime.from(`${draft.date}T${draft.time}`)
      .toZonedDateTime(draft.timeZone, { disambiguation: "compatible" })
      .toInstant();
    return {
      kind: "once",
      at: instant.toString({ smallestUnit: "millisecond" }),
      timeZone: draft.timeZone,
    };
  }
  return {
    kind: "weekly",
    daysOfWeek:
      draft.preset === "daily"
        ? [1, 2, 3, 4, 5, 6, 7]
        : draft.preset === "weekdays"
          ? [1, 2, 3, 4, 5]
          : draft.daysOfWeek,
    localTime: draft.time,
    timeZone: draft.timeZone,
  };
}

function draftForAutomation(automation: Automation): AutomationDraft {
  if (automation.schedule.kind === "windowed-interval") {
    const tomorrow = Temporal.Now.instant()
      .toZonedDateTimeISO(automation.schedule.timeZone)
      .add({ days: 1 });
    return {
      id: automation.id,
      projectId: automation.projectId,
      name: automation.name,
      prompt: automation.prompt,
      mode: automation.mode,
      target: automation.target,
      preset: "windowed-interval",
      date: tomorrow.toPlainDate().toString(),
      time: automation.schedule.startTime,
      timeZone: automation.schedule.timeZone,
      daysOfWeek: automation.schedule.daysOfWeek,
      intervalEvery: automation.schedule.every,
      intervalUnit: "minutes",
      windowStart: automation.schedule.startTime,
      windowEnd: automation.schedule.endTime,
      windowIntervalUnit: automation.schedule.unit,
      enabled: automation.enabled,
    };
  }
  if (automation.schedule.kind === "interval") {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const tomorrow = Temporal.Now.instant()
      .toZonedDateTimeISO(timeZone)
      .add({ days: 1 });
    return {
      id: automation.id,
      projectId: automation.projectId,
      name: automation.name,
      prompt: automation.prompt,
      mode: automation.mode,
      target: automation.target,
      preset: "interval",
      date: tomorrow.toPlainDate().toString(),
      time: "09:00",
      timeZone,
      daysOfWeek: [1],
      intervalEvery: automation.schedule.every,
      intervalUnit: automation.schedule.unit,
      windowStart: "09:00",
      windowEnd: "18:00",
      windowIntervalUnit: "minutes",
      enabled: automation.enabled,
    };
  }
  if (automation.schedule.kind === "once") {
    const local = Temporal.Instant.from(
      automation.schedule.at,
    ).toZonedDateTimeISO(automation.schedule.timeZone);
    return {
      id: automation.id,
      projectId: automation.projectId,
      name: automation.name,
      prompt: automation.prompt,
      mode: automation.mode,
      target: automation.target,
      preset: "once",
      date: local.toPlainDate().toString(),
      time: local.toPlainTime().toString({ smallestUnit: "minute" }),
      timeZone: automation.schedule.timeZone,
      daysOfWeek: [local.dayOfWeek],
      intervalEvery: 30,
      intervalUnit: "minutes",
      windowStart: "09:00",
      windowEnd: "18:00",
      windowIntervalUnit: "minutes",
      enabled: automation.enabled,
    };
  }
  const days = [...automation.schedule.daysOfWeek].sort(
    (left, right) => left - right,
  );
  const preset: SchedulePreset =
    days.join(",") === "1,2,3,4,5,6,7"
      ? "daily"
      : days.join(",") === "1,2,3,4,5"
        ? "weekdays"
        : "weekly";
  return {
    id: automation.id,
    projectId: automation.projectId,
    name: automation.name,
    prompt: automation.prompt,
    mode: automation.mode,
    target: automation.target,
    preset,
    date: Temporal.Now.instant()
      .toZonedDateTimeISO(automation.schedule.timeZone)
      .add({ days: 1 })
      .toPlainDate()
      .toString(),
    time: automation.schedule.localTime,
    timeZone: automation.schedule.timeZone,
    daysOfWeek: days,
    intervalEvery: 30,
    intervalUnit: "minutes",
    windowStart: "09:00",
    windowEnd: "18:00",
    windowIntervalUnit: "minutes",
    enabled: automation.enabled,
  };
}

function formatDate(value: string | undefined, locale: Locale): string {
  if (!value) return text[locale].never;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function scheduleLabel(
  automation: Pick<Automation, "schedule">,
  locale: Locale,
): string {
  const schedule = automation.schedule;
  const labels = text[locale];
  if (schedule.kind === "interval") {
    return `${labels.interval} ${schedule.every} ${labels[schedule.unit]}`;
  }
  if (schedule.kind === "windowed-interval") {
    const days = schedule.daysOfWeek
      .map((day) => weekLabels[locale][day - 1])
      .join(" ");
    return `${days} · ${schedule.startTime}–${schedule.endTime} · ${labels.interval} ${schedule.every} ${labels[schedule.unit]} · ${schedule.timeZone}`;
  }
  if (schedule.kind === "once") {
    return `${labels.once} · ${formatDate(schedule.at, locale)} · ${schedule.timeZone}`;
  }
  const dayKey = [...schedule.daysOfWeek].sort((a, b) => a - b).join(",");
  const days =
    dayKey === "1,2,3,4,5,6,7"
      ? labels.daily
      : dayKey === "1,2,3,4,5"
        ? labels.weekdays
        : `${labels.weekly} ${schedule.daysOfWeek
            .map((day) => weekLabels[locale][day - 1])
            .join(" ")}`;
  return `${days} · ${schedule.localTime} · ${schedule.timeZone}`;
}

export function AutomationPage(props: {
  locale: Locale;
  projects: Project[];
  settings?:
    | Pick<
        SettingsSnapshot,
        "models" | "addedModels" | "providers" | "selection"
      >
    | undefined;
  onConfirm(message: string, tone?: "default" | "danger"): Promise<boolean>;
  onOpenThread(threadId: string): void;
}) {
  const t = text[props.locale];
  const [state, setState] = useState<AutomationViewState>(
    createAutomationViewState,
  );
  const [projectFilter, setProjectFilter] = useState("");
  const [draft, setDraft] = useState<AutomationDraft>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [moreAutomation, setMoreAutomation] = useState<string>();
  const moreAnchor = useRef<HTMLElement | null>(null);
  const modelKey = (model: Pick<ModelSelection, "providerId" | "modelId">) =>
    JSON.stringify([model.providerId, model.modelId]);
  const models = useMemo(() => {
    const settings = props.settings;
    if (!settings) return [];
    const added = new Set(settings.addedModels.map(modelKey));
    return settings.models
      .filter(
        (model) =>
          model.configured &&
          (added.has(modelKey(model)) ||
            settings.providers.some(
              (provider) =>
                provider.id === model.providerId &&
                provider.models.some((item) => item.id === model.modelId),
            ) ||
            (settings.selection &&
              modelKey(model) === modelKey(settings.selection)) ||
            (draft?.modelSelection &&
              modelKey(model) === modelKey(draft.modelSelection))),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, props.locale) ||
          a.providerId.localeCompare(b.providerId),
      );
  }, [props.settings, props.locale, draft?.modelSelection]);
  const selection = draft?.modelSelection ?? props.settings?.selection;
  const selectedModel = models.find(
    (model) => selection && modelKey(model) === modelKey(selection),
  );
  const selectedModelKey = selection ? modelKey(selection) : "";
  const thinkingLevels = thinkingLevelsForModel(selectedModel);
  const normalizedSelection = selectedModel
    ? selectionForModelSwitch(selectedModel, selection)
    : undefined;
  const modelOptions = models.map((model) => ({
    value: modelKey(model),
    label:
      models.filter((item) => item.name === model.name).length > 1
        ? `${model.name} · ${model.providerId}`
        : model.name,
  }));
  if (!selectedModel)
    modelOptions.unshift({
      value: selectedModelKey,
      label: selection?.modelId ?? t.chooseModel,
    });
  let draftScheduleLabel = "";
  if (draft) {
    try {
      draftScheduleLabel = scheduleLabel(
        { schedule: scheduleForDraft(draft) },
        props.locale,
      );
    } catch {
      /* Keep the form editable while a date or time zone is incomplete. */
    }
  }
  const openDraft = (automation?: Automation) => {
    setMessage(undefined);
    setDraft(
      automation
        ? {
            ...draftForAutomation(automation),
            modelSelection:
              automation.modelSelection ?? props.settings?.selection,
          }
        : {
            ...defaultDraft(projectFilter || props.projects[0]?.id || ""),
            modelSelection: props.settings?.selection,
          },
    );
  };
  const filterProjectOptions = useMemo(
    () => projectSelectOptions(props.projects, [t.allProjects]),
    [props.projects, t.allProjects],
  );
  const editorProjectOptions = useMemo(() => {
    const missingProject =
      draft !== undefined &&
      !props.projects.some((project) => project.id === draft.projectId);
    const options = projectSelectOptions(
      props.projects,
      missingProject ? [t.unavailableProject] : [],
    );
    return missingProject
      ? [...options, { label: t.unavailableProject, value: draft.projectId }]
      : options;
  }, [draft?.projectId, props.projects, t.unavailableProject]);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.artemis.onAutomationEvent((event) => {
      if (!mounted) return;
      setState((current) => reduceAutomationEvent(current, event));
    });
    void window.artemis
      .listAutomations()
      .then(async (automations) => {
        const histories = await Promise.all(
          automations.map((automation) =>
            window.artemis.listAutomationRuns(automation.id, 10),
          ),
        );
        if (!mounted) return;
        setState((current) => ({
          automations: {
            ...Object.fromEntries(
              automations.map((automation) => [automation.id, automation]),
            ),
            ...current.automations,
          },
          runs: {
            ...current.runs,
            ...Object.fromEntries(histories.flat().map((run) => [run.id, run])),
          },
          seenEventIds: current.seenEventIds,
        }));
      })
      .catch((error) => mounted && setMessage(String(error)))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const automations = useMemo(
    () =>
      Object.values(state.automations)
        .filter(
          (automation) =>
            !projectFilter || automation.projectId === projectFilter,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [projectFilter, state.automations],
  );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !normalizedSelection || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const saved = await window.artemis.saveAutomation({
        ...(draft.id ? { id: draft.id } : {}),
        projectId: draft.projectId,
        name: draft.name,
        prompt: draft.prompt,
        mode: draft.mode,
        target: draft.target,
        modelSelection: normalizedSelection,
        schedule: scheduleForDraft(draft),
        enabled: draft.enabled,
      });
      if (saved.authorizationState === "required") {
        await window.artemis.authorizeAutomation(saved.id);
      }
      setDraft(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const invoke = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DataSurface
      busy={busy}
      className="automation-page"
      label={t.title}
      state={message ? "error" : busy ? "busy" : "ready"}
    >
      <ManagementHeader
        actions={
          <Button
            className="automation-create-button"
            disabled={props.projects.length === 0}
            icon={
              <ArtemisIcon
                className="automation-create-icon"
                height={16}
                name="plus"
                width={16}
              />
            }
            onClick={() => openDraft()}
            variant="primary"
          >
            {t.create}
          </Button>
        }
        leading={
          <img
            className="automation-header-artwork"
            src={automationHeaderIcon}
            alt=""
          />
        }
        className="automation-header"
        description={t.pageSubtitle}
        title={t.title}
      />

      <div className="automation-toolbar">
        <Select
          className="automation-project-filter"
          label={t.project}
          onValueChange={setProjectFilter}
          options={[
            { label: t.allProjects, value: "" },
            ...filterProjectOptions,
          ]}
          size="compact"
          value={projectFilter}
        />
        <span className="automation-count">
          {uiText(props.locale, "AutomationPage_text.taskCount", {
            count: automations.length,
          })}
        </span>
        {message && !draft ? (
          <ErrorState className="automation-message">{message}</ErrorState>
        ) : null}
      </div>

      <div className="automation-list">
        {automations.map((automation) => {
          const runs = Object.values(state.runs)
            .filter((run) => run.automationId === automation.id)
            .sort((left, right) =>
              right.createdAt.localeCompare(left.createdAt),
            );
          const project = props.projects.find(
            (candidate) => candidate.id === automation.projectId,
          );
          const taskSelection =
            automation.modelSelection ?? props.settings?.selection;
          const taskModel = props.settings?.models.find(
            (model) =>
              taskSelection && modelKey(model) === modelKey(taskSelection),
          );
          const statusLabel =
            automation.authorizationState === "required"
              ? t.authorizationRequired
              : automation.enabled
                ? t.enabled
                : t.paused;
          return (
            <ManagementCard className="automation-card" key={automation.id}>
              <div className="automation-card-heading">
                <div>
                  <h2>{automation.name}</h2>
                  <span>
                    {project?.name ?? t.unavailableProject} ·{" "}
                    {uiText(props.locale, `App_copy.${automation.mode}`)} ·{" "}
                    {automation.target === "local" ? t.local : t.managed}
                  </span>
                </div>
                <Status
                  className="automation-state"
                  tone={
                    automation.authorizationState === "required"
                      ? "warning"
                      : automation.enabled
                        ? "success"
                        : "neutral"
                  }
                >
                  {statusLabel}
                </Status>
              </div>
              <p className="automation-prompt">{automation.prompt}</p>
              <div className="automation-meta">
                <span className="automation-schedule-label">
                  <ArtemisIcon name="clock" />
                  {scheduleLabel(automation, props.locale)}
                </span>
                <span>
                  {automation.enabled
                    ? `${t.nextRun}: ${formatDate(automation.nextRunAt, props.locale)}`
                    : t.pausedUntilEnabled}
                </span>
              </div>
              <p className="automation-model-summary">
                {t.model}:{" "}
                {taskModel?.name ?? taskSelection?.modelId ?? t.chooseModel}
                {taskSelection && (
                  <>
                    {" "}
                    · {t.thinking}:{" "}
                    {taskSelection.ultraMode
                      ? UI_COPY.App_copy[props.locale].ultraMode
                      : thinkingLevelLabel(
                          taskSelection.thinkingLevel,
                          props.locale,
                        )}
                  </>
                )}
              </p>
              <div className="automation-card-footer">
                <div className="automation-actions">
                  {automation.authorizationState === "required" && (
                    <Button
                      icon={<ArtemisIcon name="approval" />}
                      disabled={busy}
                      onClick={() =>
                        void invoke(() =>
                          window.artemis.authorizeAutomation(automation.id),
                        )
                      }
                    >
                      {t.authorize}
                    </Button>
                  )}
                  <Button
                    icon={<ArtemisIcon name="send" />}
                    disabled={
                      busy || automation.authorizationState === "required"
                    }
                    onClick={() =>
                      void invoke(() =>
                        window.artemis.runAutomationNow(automation.id),
                      )
                    }
                  >
                    {t.runNow}
                  </Button>
                  <Button
                    icon={
                      automation.enabled ? (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <path d="M9 5v14M15 5v14" />
                        </svg>
                      ) : (
                        <ArtemisIcon name="send" />
                      )
                    }
                    disabled={busy}
                    onClick={() =>
                      void invoke(() =>
                        window.artemis.setAutomationEnabled(
                          automation.id,
                          !automation.enabled,
                        ),
                      )
                    }
                  >
                    {automation.enabled ? t.pauseTask : t.enableTask}
                  </Button>
                  <Button
                    icon={<ArtemisIcon name="edit" />}
                    disabled={busy}
                    onClick={() => openDraft(automation)}
                  >
                    {t.edit}
                  </Button>
                  <IconButton
                    disabled={busy}
                    label={t.moreActions}
                    aria-expanded={moreAutomation === automation.id}
                    icon={<ArtemisIcon name="more" />}
                    onClick={(event) => {
                      moreAnchor.current = event.currentTarget;
                      setMoreAutomation(
                        moreAutomation === automation.id
                          ? undefined
                          : automation.id,
                      );
                    }}
                  />
                </div>
                <details className="automation-history">
                  <summary>
                    {t.history}
                    <ArtemisIcon name="chevron" />
                  </summary>
                  <div className="automation-history-content">
                    <span>
                      {t.lastRun}:{" "}
                      {formatDate(automation.lastRunAt, props.locale)}
                    </span>
                    {runs.length === 0 ? (
                      <span>{t.noRuns}</span>
                    ) : (
                      runs.slice(0, 5).map((run) => (
                        <Button
                          align="start"
                          className="automation-history-row"
                          disabled={!run.threadId}
                          key={run.id}
                          onClick={() =>
                            run.threadId && props.onOpenThread(run.threadId)
                          }
                          variant="quiet"
                        >
                          <span className={`automation-run-dot ${run.state}`} />
                          <span>
                            {formatDate(run.scheduledFor, props.locale)}
                          </span>
                          <span>{statusText(props.locale, run.state)}</span>
                          {run.reason && <small>{run.reason}</small>}
                        </Button>
                      ))
                    )}
                  </div>
                </details>
              </div>
            </ManagementCard>
          );
        })}
        {loading ? (
          <div className="automation-loading" aria-busy="true">
            <div />
            <div />
          </div>
        ) : automations.length === 0 && !message ? (
          <EmptyState
            className="automation-empty"
            title={t.empty}
            description={t.emptyDescription}
            icon={<ArtemisIcon name="automation" />}
          />
        ) : null}
      </div>

      <p className="automation-local-note">
        <ArtemisIcon name="info" />
        {t.subtitle}
      </p>
      <Popover
        className="automation-more-menu"
        align="end"
        anchorRef={moreAnchor}
        label={t.moreActions}
        open={moreAutomation !== undefined}
        onOpenChange={(open) => {
          if (!open) setMoreAutomation(undefined);
        }}
      >
        <Button
          className="management-destructive-action"
          icon={<ArtemisIcon name="trash" />}
          disabled={busy}
          variant="quiet"
          onClick={() => {
            const id = moreAutomation;
            setMoreAutomation(undefined);
            if (id)
              void invoke(async () => {
                if (await props.onConfirm(t.deleteConfirm, "danger"))
                  await window.artemis.deleteAutomation(id);
              });
          }}
        >
          {t.delete}
        </Button>
      </Popover>
      <Dialog
        className="automation-dialog-shell"
        closeOnBackdrop={!busy}
        closeOnEscape={!busy}
        label={draft?.id ? t.edit : t.create}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(undefined);
        }}
        open={draft !== undefined}
      >
        {draft ? (
          <form
            className="automation-dialog"
            onSubmit={(event) => void save(event)}
          >
            <div className="automation-dialog-heading">
              <div>
                <h2>{draft.id ? t.edit : t.create}</h2>
                <p>{t.editorSubtitle}</p>
              </div>
              <IconButton
                disabled={busy}
                label={I18N_RESOURCES[props.locale].settings.close}
                icon={<ArtemisIcon name="close" />}
                onClick={() => setDraft(undefined)}
              />
            </div>
            <fieldset className="automation-editor-body" disabled={busy}>
              <section className="automation-instructions">
                <TextField
                  label={t.name}
                  maxLength={120}
                  onValueChange={(name) => setDraft({ ...draft, name })}
                  required
                  value={draft.name}
                />
                <Select
                  labelVisibility="visible"
                  disabled={Boolean(draft.id)}
                  label={t.project}
                  onValueChange={(projectId) =>
                    setDraft({ ...draft, projectId })
                  }
                  options={editorProjectOptions}
                  value={draft.projectId}
                />
                <TextAreaField
                  label={t.prompt}
                  maxLength={32 * 1024}
                  onValueChange={(prompt) => setDraft({ ...draft, prompt })}
                  required
                  className="automation-prompt-field"
                  rows={8}
                  value={draft.prompt}
                />
              </section>
              <section className="automation-configuration">
                <h3>{t.executionSettings}</h3>
                <div className="automation-form-grid">
                  <Select
                    labelVisibility="visible"
                    label={t.mode}
                    onValueChange={(mode) => {
                      setDraft({
                        ...draft,
                        mode,
                        target: isExecutionMode(mode)
                          ? "managed-worktree"
                          : draft.target,
                      });
                    }}
                    options={(["plan", "work", "codemode"] as const).map(
                      (mode) => ({
                        label: uiText(props.locale, `App_copy.${mode}`),
                        value: mode,
                      }),
                    )}
                    value={draft.mode}
                  />
                  <Select
                    labelVisibility="visible"
                    label={t.target}
                    onValueChange={(target) => setDraft({ ...draft, target })}
                    options={[
                      { label: t.local, value: "local" },
                      { label: t.managed, value: "managed-worktree" },
                    ]}
                    value={draft.target}
                  />
                </div>
                <Select
                  labelVisibility="visible"
                  label={t.model}
                  disabled={busy || models.length === 0}
                  error={
                    !selectedModel
                      ? models.length === 0
                        ? t.noModels
                        : t.modelUnavailable
                      : undefined
                  }
                  value={selectedModelKey}
                  options={modelOptions}
                  onValueChange={(value) => {
                    const model = models.find(
                      (item) => modelKey(item) === value,
                    );
                    if (model)
                      setDraft({
                        ...draft,
                        modelSelection: selectionForModelSwitch(
                          model,
                          selection,
                        ),
                      });
                  }}
                />
                <Select
                  labelVisibility="visible"
                  label={t.thinking}
                  disabled={busy || !selectedModel?.reasoning}
                  description={t.reasoningHint}
                  value={
                    normalizedSelection?.ultraMode
                      ? "ultra"
                      : (normalizedSelection?.thinkingLevel ?? "off")
                  }
                  options={[
                    ...(thinkingLevels.length
                      ? thinkingLevels
                      : ["off" as const]
                    ).map((level) => ({
                      label: thinkingLevelLabel(level, props.locale),
                      value: level as string,
                    })),
                    ...(normalizedSelection?.ultraMode
                      ? [
                          {
                            label: UI_COPY.App_copy[props.locale].ultraMode,
                            value: "ultra",
                          },
                        ]
                      : []),
                  ]}
                  onValueChange={(value) => {
                    if (!normalizedSelection || value === "ultra") return;
                    setDraft({
                      ...draft,
                      modelSelection: {
                        providerId: normalizedSelection.providerId,
                        modelId: normalizedSelection.modelId,
                        thinkingLevel: value as ModelSelection["thinkingLevel"],
                      },
                    });
                  }}
                />
                <h3 className="automation-schedule-heading">
                  {t.scheduleSettings}
                </h3>
                <div className="automation-form-grid">
                  <Select
                    labelVisibility="visible"
                    label={t.schedule}
                    onValueChange={(preset) => setDraft({ ...draft, preset })}
                    options={(
                      [
                        "once",
                        "interval",
                        "windowed-interval",
                        "daily",
                        "weekdays",
                        "weekly",
                      ] as const
                    ).map((preset) => ({
                      label:
                        preset === "windowed-interval"
                          ? t.windowedInterval
                          : t[preset],
                      value: preset,
                    }))}
                    value={draft.preset}
                  />
                  {draft.preset === "once" && (
                    <label>
                      <span>{t.date}</span>
                      <input
                        disabled={busy}
                        onChange={(event) =>
                          setDraft({ ...draft, date: event.target.value })
                        }
                        required
                        type="date"
                        value={draft.date}
                      />
                    </label>
                  )}
                  {(draft.preset === "interval" ||
                    draft.preset === "windowed-interval") && (
                    <div className="automation-interval-field">
                      <div className="automation-interval-controls">
                        <TextField
                          label={t.interval}
                          max={10_000}
                          min={1}
                          onValueChange={(value) =>
                            setDraft({
                              ...draft,
                              intervalEvery: Number(value),
                            })
                          }
                          required
                          type="number"
                          value={String(draft.intervalEvery)}
                        />
                        <Select
                          labelVisibility="visible"
                          label={t.intervalUnit}
                          onValueChange={(unit) => {
                            setDraft(
                              draft.preset === "windowed-interval"
                                ? {
                                    ...draft,
                                    windowIntervalUnit:
                                      unit as WindowedIntervalUnit,
                                  }
                                : {
                                    ...draft,
                                    intervalUnit: unit as IntervalUnit,
                                  },
                            );
                          }}
                          options={(draft.preset === "windowed-interval"
                            ? (["minutes", "hours"] as const)
                            : (["minutes", "hours", "days"] as const)
                          ).map((unit) => ({ label: t[unit], value: unit }))}
                          value={
                            draft.preset === "windowed-interval"
                              ? draft.windowIntervalUnit
                              : draft.intervalUnit
                          }
                        />
                      </div>
                    </div>
                  )}
                  {draft.preset !== "interval" && (
                    <>
                      {draft.preset === "windowed-interval" ? (
                        <div className="automation-window-fields">
                          <div className="automation-time-field">
                            <span>{t.windowStart}</span>
                            <TimePicker
                              hourLabel={t.hour}
                              label={t.windowStart}
                              minuteLabel={t.minute}
                              onChange={(windowStart) =>
                                setDraft({ ...draft, windowStart })
                              }
                              value={draft.windowStart}
                            />
                          </div>
                          <div className="automation-time-field">
                            <span>{t.windowEnd}</span>
                            <TimePicker
                              hourLabel={t.hour}
                              label={t.windowEnd}
                              minuteLabel={t.minute}
                              onChange={(windowEnd) =>
                                setDraft({ ...draft, windowEnd })
                              }
                              value={draft.windowEnd}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="automation-time-field">
                          <span>{t.time}</span>
                          <TimePicker
                            hourLabel={t.hour}
                            label={t.chooseTime}
                            minuteLabel={t.minute}
                            onChange={(time) => setDraft({ ...draft, time })}
                            value={draft.time}
                          />
                        </div>
                      )}
                      <TextField
                        className="automation-time-zone"
                        label={t.timeZone}
                        onValueChange={(timeZone) =>
                          setDraft({ ...draft, timeZone })
                        }
                        required
                        value={draft.timeZone}
                      />
                    </>
                  )}
                </div>
                {(draft.preset === "weekly" ||
                  draft.preset === "windowed-interval") && (
                  <div className="automation-weekdays">
                    {weekLabels[props.locale].map((label, index) => {
                      const day = index + 1;
                      return (
                        <Checkbox
                          checked={draft.daysOfWeek.includes(day)}
                          key={day}
                          label={label}
                          onCheckedChange={(checked) =>
                            setDraft({
                              ...draft,
                              daysOfWeek: checked
                                ? [...draft.daysOfWeek, day]
                                : draft.daysOfWeek.filter(
                                    (candidate) => candidate !== day,
                                  ),
                            })
                          }
                        />
                      );
                    })}
                  </div>
                )}
                {isExecutionMode(draft.mode) && (
                  <InlineNotice className="automation-warning" tone="warning">
                    {t.executeWarning}
                  </InlineNotice>
                )}
              </section>
            </fieldset>
            {message ? (
              <ErrorState className="automation-message" role="alert">
                {message}
              </ErrorState>
            ) : null}
            <div className="automation-dialog-footer">
              <span className="automation-schedule-summary">
                <ArtemisIcon name="clock" />
                {draftScheduleLabel}
              </span>
              <div className="automation-dialog-actions">
                <Button disabled={busy} onClick={() => setDraft(undefined)}>
                  {t.cancel}
                </Button>
                <Button
                  disabled={
                    busy ||
                    !normalizedSelection ||
                    ((draft.preset === "weekly" ||
                      draft.preset === "windowed-interval") &&
                      draft.daysOfWeek.length === 0) ||
                    ((draft.preset === "interval" ||
                      draft.preset === "windowed-interval") &&
                      (!Number.isInteger(draft.intervalEvery) ||
                        draft.intervalEvery < 1 ||
                        draft.intervalEvery > 10_000)) ||
                    (draft.preset === "windowed-interval" &&
                      draft.windowStart === draft.windowEnd)
                  }
                  type="submit"
                  variant="primary"
                >
                  {t.save}
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </Dialog>
    </DataSurface>
  );
}
