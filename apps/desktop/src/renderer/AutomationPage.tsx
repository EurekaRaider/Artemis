import { Temporal } from "@js-temporal/polyfill";
import {
  createAutomationViewState,
  reduceAutomationEvent,
  type Automation,
  type AutomationSchedule,
  type AutomationTarget,
  type AppLocale,
  type AutomationViewState,
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
import { Button, Status } from "@artemis/ui/actions";
import { DataSurface } from "@artemis/ui/data";
import {
  Dialog,
  EmptyState,
  ErrorState,
  InlineNotice,
} from "@artemis/ui/feedback";
import { Checkbox, Select, TextAreaField, TextField } from "@artemis/ui/forms";
import { ManagementCard, ManagementHeader } from "@artemis/ui/management";
import { legacyLocale } from "../shared/locales.js";
import { localizedCopy } from "../shared/i18n-resources.js";

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
}

const text = {
  en: {
    title: "Automations",
    subtitle:
      "Runs locally while Artemis is open. On restart, only the latest missed occurrence runs.",
    create: "New automation",
    allProjects: "All projects",
    empty: "No automations yet.",
    enabled: "Enabled",
    paused: "Paused",
    authorizationRequired: "Authorization required",
    authorize: "Authorize",
    runNow: "Run now",
    edit: "Edit",
    delete: "Delete",
    history: "Recent runs",
    noRuns: "No runs yet",
    nextRun: "Next",
    lastRun: "Last",
    never: "Never",
    save: "Save",
    cancel: "Cancel",
    name: "Name",
    prompt: "Prompt",
    project: "Project",
    mode: "Mode",
    target: "Workspace",
    schedule: "Schedule",
    date: "Date",
    time: "Time",
    chooseTime: "Choose time",
    hour: "Hour",
    minute: "Minute",
    timeZone: "Time zone",
    once: "Once",
    daily: "Every day",
    weekdays: "Weekdays",
    weekly: "Weekly",
    interval: "Every",
    windowedInterval: "Within a time window",
    windowStart: "Window starts",
    windowEnd: "Window ends",
    intervalUnit: "Unit",
    minutes: "Minutes",
    hours: "Hours",
    days: "Days",
    local: "Local project",
    managed: "Managed worktree",
    unavailableProject: "Unavailable project",
    deleteConfirm: "Delete this automation? Run history and tasks remain.",
    executeWarning:
      "Execute requires explicit unattended authorization after saving.",
  },
  "zh-CN": {
    title: "定时任务",
    subtitle:
      "仅在 Artemis 运行时本地执行；重新启动后只补跑最近一次错过的任务。",
    create: "新建定时任务",
    allProjects: "全部项目",
    empty: "还没有定时任务。",
    enabled: "已启用",
    paused: "已暂停",
    authorizationRequired: "需要授权",
    authorize: "授权",
    runNow: "立即运行",
    edit: "编辑",
    delete: "删除",
    history: "最近运行",
    noRuns: "尚未运行",
    nextRun: "下次",
    lastRun: "上次",
    never: "从未",
    save: "保存",
    cancel: "取消",
    name: "名称",
    prompt: "任务内容",
    project: "项目",
    mode: "模式",
    target: "工作区",
    schedule: "执行时间",
    date: "日期",
    time: "时间",
    chooseTime: "选择时间",
    hour: "小时",
    minute: "分钟",
    timeZone: "时区",
    once: "一次",
    daily: "每天",
    weekdays: "工作日",
    weekly: "每周",
    interval: "每隔",
    windowedInterval: "指定时间段内按间隔",
    windowStart: "开始时间",
    windowEnd: "结束时间",
    intervalUnit: "单位",
    minutes: "分钟",
    hours: "小时",
    days: "天",
    local: "本地项目",
    managed: "托管 Worktree",
    unavailableProject: "不可用项目",
    deleteConfirm: "删除这个定时任务？已生成的任务和运行历史仍会保留。",
    executeWarning: "Execute 保存后必须明确授权无人值守执行。",
  },
} as const;

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

const weekLabels = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  "zh-CN": ["一", "二", "三", "四", "五", "六", "日"],
} as const;

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
        <svg
          aria-hidden="true"
          className="automation-time-clock"
          fill="none"
          viewBox="0 0 16 16"
        >
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 4.8v3.5l2.25 1.35" />
        </svg>
        <span className="automation-time-value">
          <span>{selectedHour}</span>
          <span aria-hidden="true" className="automation-time-colon">
            :
          </span>
          <span>{selectedMinute}</span>
        </span>
        <svg
          aria-hidden="true"
          className="automation-time-chevron"
          fill="none"
          viewBox="0 0 16 16"
        >
          <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
        </svg>
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
    mode: "review",
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
  if (!value) return text[legacyLocale(locale)].never;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function scheduleLabel(automation: Automation, locale: Locale): string {
  const schedule = automation.schedule;
  const labels = localizedCopy(
    locale,
    "automations",
    text[legacyLocale(locale)],
  );
  if (schedule.kind === "interval") {
    return `${labels.interval} ${schedule.every} ${labels[schedule.unit]}`;
  }
  if (schedule.kind === "windowed-interval") {
    const days = schedule.daysOfWeek
      .map((day) => weekLabels[legacyLocale(locale)][day - 1])
      .join(" ");
    return `${days} · ${schedule.startTime}–${schedule.endTime} · ${labels.interval} ${schedule.every} ${labels[schedule.unit]} · ${schedule.timeZone}`;
  }
  if (schedule.kind === "once") {
    return `${labels.once} · ${formatDate(schedule.at, locale)} · ${schedule.timeZone}`;
  }
  const days = schedule.daysOfWeek
    .map((day) => weekLabels[legacyLocale(locale)][day - 1])
    .join(" ");
  return `${days} · ${schedule.localTime} · ${schedule.timeZone}`;
}

export function AutomationPage(props: {
  locale: Locale;
  projects: Project[];
  onConfirm(message: string, tone?: "default" | "danger"): Promise<boolean>;
  onOpenThread(threadId: string): void;
}) {
  const t = localizedCopy(
    props.locale,
    "automations",
    text[legacyLocale(props.locale)],
  );
  const [state, setState] = useState<AutomationViewState>(
    createAutomationViewState,
  );
  const [projectFilter, setProjectFilter] = useState("");
  const [draft, setDraft] = useState<AutomationDraft>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
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
      .catch((error) => setMessage(String(error)));
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
    if (!draft) return;
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
              <svg className="automation-create-icon" viewBox="0 0 16 16">
                <path d="M8 3.25v9.5M3.25 8h9.5" />
              </svg>
            }
            onClick={() =>
              setDraft(
                defaultDraft(projectFilter || props.projects[0]?.id || ""),
              )
            }
            variant="primary"
          >
            {t.create}
          </Button>
        }
        className="automation-header"
        description={t.subtitle}
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
        {message ? (
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
                  <span>{project?.name}</span>
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
                <span>{scheduleLabel(automation, props.locale)}</span>
                <span>
                  {automation.mode.toUpperCase()} ·{" "}
                  {automation.target === "local" ? t.local : t.managed}
                </span>
                <span>
                  {t.nextRun}: {formatDate(automation.nextRunAt, props.locale)}
                </span>
                <span>
                  {t.lastRun}: {formatDate(automation.lastRunAt, props.locale)}
                </span>
              </div>
              <div className="automation-actions">
                {automation.authorizationState === "required" && (
                  <Button
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
                  {automation.enabled ? t.paused : t.enabled}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setDraft(draftForAutomation(automation))}
                >
                  {t.edit}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void invoke(async () => {
                      if (!(await props.onConfirm(t.deleteConfirm, "danger"))) {
                        return;
                      }
                      await window.artemis.deleteAutomation(automation.id);
                    })
                  }
                  variant="danger"
                >
                  {t.delete}
                </Button>
              </div>
              <div className="automation-history">
                <strong>{t.history}</strong>
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
                      <span>{formatDate(run.scheduledFor, props.locale)}</span>
                      <span>{run.state}</span>
                      {run.reason && <small>{run.reason}</small>}
                    </Button>
                  ))
                )}
              </div>
            </ManagementCard>
          );
        })}
        {automations.length === 0 && (
          <EmptyState className="automation-empty" title={t.empty} />
        )}
      </div>

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
            <h2>{draft.id ? t.edit : t.create}</h2>
            <Select
              disabled={Boolean(draft.id)}
              label={t.project}
              onValueChange={(projectId) => setDraft({ ...draft, projectId })}
              options={editorProjectOptions}
              value={draft.projectId}
            />
            <TextField
              label={t.name}
              maxLength={120}
              onValueChange={(name) => setDraft({ ...draft, name })}
              required
              value={draft.name}
            />
            <TextAreaField
              label={t.prompt}
              maxLength={32 * 1024}
              onValueChange={(prompt) => setDraft({ ...draft, prompt })}
              required
              rows={6}
              value={draft.prompt}
            />
            <div className="automation-form-grid">
              <Select
                label={t.mode}
                onValueChange={(mode) => {
                  setDraft({
                    ...draft,
                    mode,
                    target:
                      mode === "execute" ? "managed-worktree" : draft.target,
                  });
                }}
                options={(["plan", "execute", "review"] as const).map(
                  (mode) => ({ label: mode, value: mode }),
                )}
                value={draft.mode}
              />
              <Select
                label={t.target}
                onValueChange={(target) => setDraft({ ...draft, target })}
                options={[
                  { label: t.local, value: "local" },
                  { label: t.managed, value: "managed-worktree" },
                ]}
                value={draft.target}
              />
              <Select
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
                      label={t.intervalUnit}
                      onValueChange={(unit) => {
                        setDraft(
                          draft.preset === "windowed-interval"
                            ? {
                                ...draft,
                                windowIntervalUnit:
                                  unit as WindowedIntervalUnit,
                              }
                            : { ...draft, intervalUnit: unit as IntervalUnit },
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
                {weekLabels[legacyLocale(props.locale)].map((label, index) => {
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
            {draft.mode === "execute" && (
              <InlineNotice className="automation-warning" tone="warning">
                {t.executeWarning}
              </InlineNotice>
            )}
            <div className="automation-dialog-actions">
              <Button disabled={busy} onClick={() => setDraft(undefined)}>
                {t.cancel}
              </Button>
              <Button
                disabled={
                  busy ||
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
          </form>
        ) : null}
      </Dialog>
    </DataSurface>
  );
}
