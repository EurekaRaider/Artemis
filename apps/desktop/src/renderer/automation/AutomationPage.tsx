import { TimePicker } from "./AutomationTimePicker.js";
import {
  type Locale,
  type IntervalUnit,
  type WindowedIntervalUnit,
} from "./automation-values.js";
import { useAutomationState } from "./controllers/use-automation-state.js";
import { useAutomationModelSelection } from "./controllers/use-automation-model-selection.js";
import { createAutomationScheduleLabel } from "./controllers/create-automation-schedule-label.js";
import { useAutomationDraft } from "./controllers/use-automation-draft.js";
import { useAutomationProjectOptions } from "./controllers/use-automation-project-options.js";
import { useAutomationSubscription } from "./controllers/use-automation-subscription.js";
import { useAutomationList } from "./controllers/use-automation-list.js";
import { createAutomationActions } from "./controllers/create-automation-actions.js";
import { nextRunLabel } from "./schedule-label.js";
import {
  formatDate,
  scheduleLabel,
  scheduleTimeZone,
  weekLabels,
} from "./schedule-label.js";
import { SegmentedControl } from "@artemis/ui/navigation";
import { isExecutionMode } from "@artemis/protocol";
import { statusText } from "../../shared/i18n/status-text.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { I18N_RESOURCES } from "../../shared/i18n/i18n-resources.js";
import type { SettingsSnapshot } from "../../shared/api.js";
import {
  selectionForModelSwitch,
  thinkingLevelLabel,
} from "../settings/model-selection.js";

import { type ModelSelection, type Project } from "@artemis/protocol";

import { createPortal } from "react-dom";
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
import {
  Checkbox,
  Select,
  Switch,
  TextAreaField,
  TextField,
} from "@artemis/ui/forms";
import { ManagementCard, ManagementHeader } from "@artemis/ui/management";

export function AutomationPage(props: {
  locale: Locale;
  headerActionTarget?: HTMLElement | null | undefined;
  initialAutomationId?: string | undefined;
  initialDraftRequest?: { projectId: string; token: number } | undefined;
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
  const {
    t,
    state,
    setState,
    projectFilter,
    setProjectFilter,
    statusFilter,
    setStatusFilter,
    selectedAutomationId,
    setSelectedAutomationId,
    draft,
    setDraft,
    busy,
    setBusy,
    message,
    setMessage,
    loading,
    setLoading,
    moreAutomation,
    setMoreAutomation,
    moreAnchor,
  } = useAutomationState({ props });
  const {
    modelKey,
    models,
    selection,
    selectedModel,
    selectedModelKey,
    thinkingLevels,
    normalizedSelection,
    modelOptions,
  } = useAutomationModelSelection({ props, draft, t });
  const { draftScheduleLabel } = createAutomationScheduleLabel({
    draft,
    props,
  });
  const { openDraft } = useAutomationDraft({
    setMessage,
    projectFilter,
    props,
    setDraft,
  });
  const { filterProjectOptions, editorProjectOptions } =
    useAutomationProjectOptions({ props, t, draft });

  useAutomationSubscription({ setState, setLoading, setMessage });

  const { automations, selectedAutomation } = useAutomationList({
    projectFilter,
    statusFilter,
    state,
    selectedAutomationId,
  });

  const { save, invoke } = createAutomationActions({
    draft,
    normalizedSelection,
    busy,
    setBusy,
    setMessage,
    setDraft,
  });

  const moreRecord = moreAutomation
    ? state.automations[moreAutomation]
    : undefined;
  const createAction = (
    <Button
      className="automation-create-button"
      iconSize="sm"
      disabled={props.projects.length === 0}
      icon={
        <ArtemisIcon
          className="automation-create-icon"
          height={14}
          name="plus"
          width={14}
        />
      }
      onClick={() => openDraft()}
      variant="primary"
    >
      {t.create}
    </Button>
  );

  return (
    <DataSurface
      busy={busy}
      className="automation-page"
      label={t.title}
      state={message ? "error" : busy ? "busy" : "ready"}
    >
      {props.headerActionTarget &&
        createPortal(createAction, props.headerActionTarget)}

      <div className="automation-master-detail">
        <div className="automation-master" aria-label={t.title}>
          <ManagementHeader
            actions={props.headerActionTarget ? undefined : createAction}
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
            <SegmentedControl
              label={t.title}
              size="compact"
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={[
                { value: "all", label: uiText(props.locale, "Review01.all") },
                {
                  value: "enabled",
                  label: uiText(props.locale, "AutomationPage_filter.enabled"),
                },
                {
                  value: "paused",
                  label: uiText(props.locale, "AutomationPage_filter.paused"),
                },
              ]}
            />
            {message && !draft ? (
              <ErrorState className="automation-message">{message}</ErrorState>
            ) : null}
          </div>

          <div className="automation-master-list">
            {automations.map((automation) => {
              const latestRun = Object.values(state.runs)
                .filter((run) => run.automationId === automation.id)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
              const project = props.projects.find(
                (item) => item.id === automation.projectId,
              );
              return (
                <div
                  className="automation-master-row"
                  data-enabled={automation.enabled}
                  data-selected={selectedAutomation?.id === automation.id}
                  key={automation.id}
                >
                  <Button
                    variant="quiet"
                    align="start"
                    selected={selectedAutomation?.id === automation.id}
                    onClick={() => setSelectedAutomationId(automation.id)}
                  >
                    <span className="automation-master-copy">
                      <strong>{automation.name}</strong>
                      <span>
                        {project?.name ?? t.unavailableProject} ·{" "}
                        {uiText(props.locale, `App_copy.${automation.mode}`)}
                      </span>
                      <small
                        className={
                          automation.enabled ? undefined : "automation-next-run"
                        }
                      >
                        <ArtemisIcon
                          name={automation.enabled ? "calendar" : "pause"}
                          width={12}
                          height={12}
                        />
                        {automation.enabled ? (
                          <>
                            <span>
                              {scheduleLabel(automation, props.locale)}
                            </span>
                            {latestRun?.state === "failed" ? (
                              <span
                                className="automation-latest-failure"
                                data-state="failed"
                              >
                                <span
                                  className="automation-run-dot failed"
                                  aria-hidden="true"
                                />
                                {uiText(
                                  props.locale,
                                  "AutomationPage_text.lastFailed",
                                )}
                              </span>
                            ) : (
                              <span className="automation-next-run">
                                · {nextRunLabel(automation, props.locale)}
                              </span>
                            )}
                          </>
                        ) : (
                          t.pausedUntilEnabled
                        )}
                      </small>
                    </span>
                  </Button>
                  <Switch
                    checked={automation.enabled}
                    disabled={busy}
                    label={`${automation.enabled ? t.pauseTask : t.enableTask}: ${automation.name}`}
                    labelVisibility="hidden"
                    onCheckedChange={(enabled) =>
                      void invoke(() =>
                        window.artemis.setAutomationEnabled(
                          automation.id,
                          enabled,
                        ),
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
          <p className="automation-local-note">
            <ArtemisIcon name="info" />
            {t.subtitle}
          </p>
        </div>
        <div className="automation-list automation-detail">
          {automations
            .filter((item) => item.id === selectedAutomation?.id)
            .map((automation) => {
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
                    <div className="automation-title-block">
                      <div className="automation-title-line">
                        <h2>{automation.name}</h2>
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
                      <span>
                        {automation.lastRunAt
                          ? `${t.lastRun}${props.locale.startsWith("zh") ? "：" : ": "}${formatDate(automation.lastRunAt, props.locale)}`
                          : uiText(props.locale, "Review03.notRun")}
                      </span>
                    </div>
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
                        icon={<ArtemisIcon name="play" />}
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
                  </div>
                  <p className="automation-prompt">{automation.prompt}</p>
                  <dl className="automation-context">
                    <div>
                      <dt>
                        {t.project} · {t.target}
                      </dt>
                      <dd>
                        <ArtemisIcon name="folder" />
                        <span title={project?.name ?? t.unavailableProject}>
                          {project?.name ?? t.unavailableProject} ·{" "}
                          {automation.target === "local" ? t.local : t.managed}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>{t.mode}</dt>
                      <dd>
                        <ArtemisIcon
                          name={
                            automation.mode === "codemode"
                              ? "code"
                              : automation.mode
                          }
                        />
                        <span>
                          {uiText(props.locale, `App_copy.${automation.mode}`)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>{t.model}</dt>
                      <dd className="automation-model-summary">
                        <ArtemisIcon name="model" />
                        <span>
                          {taskModel?.name ??
                            taskSelection?.modelId ??
                            uiText(props.locale, "Review03.followDefault")}
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
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <div className="automation-schedule">
                    <div className="automation-schedule-heading">
                      <span>
                        {uiText(props.locale, "Review03.schedule")}
                        {scheduleTimeZone(automation)
                          ? ` · ${scheduleTimeZone(automation)}`
                          : ""}
                      </span>
                      <span title={scheduleLabel(automation, props.locale)}>
                        {automation.enabled
                          ? `${nextRunLabel(automation, props.locale)}`
                          : t.pausedUntilEnabled}
                      </span>
                    </div>
                    {!("daysOfWeek" in automation.schedule) && (
                      <span className="automation-schedule-label">
                        <ArtemisIcon name="calendar" />
                        {scheduleLabel(automation, props.locale)}
                      </span>
                    )}
                    {"daysOfWeek" in automation.schedule && (
                      <div
                        className="automation-week"
                        aria-label={scheduleLabel(automation, props.locale)}
                      >
                        {weekLabels[props.locale].map((day, index) => {
                          const scheduled =
                            "daysOfWeek" in automation.schedule &&
                            automation.schedule.daysOfWeek.includes(index + 1);
                          return (
                            <div key={index} data-scheduled={scheduled}>
                              <span>{day}</span>
                              <small>
                                {scheduled ? (
                                  automation.schedule.kind ===
                                  "windowed-interval" ? (
                                    automation.schedule.startTime
                                  ) : automation.schedule.kind === "weekly" ? (
                                    automation.schedule.localTime
                                  ) : (
                                    <i
                                      className="automation-unscheduled-dot"
                                      aria-hidden="true"
                                    />
                                  )
                                ) : (
                                  <i
                                    className="automation-unscheduled-dot"
                                    aria-hidden="true"
                                  />
                                )}
                              </small>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="automation-card-footer">
                    <details className="automation-history" open>
                      <summary>
                        {t.history}
                        <ArtemisIcon name="chevron" />
                      </summary>
                      <div className="automation-history-content">
                        {runs.length === 0 ? (
                          <span>{t.noRuns}</span>
                        ) : (
                          runs.slice(0, 5).map((run) => (
                            <div className="automation-run" key={run.id}>
                              <Button
                                align="start"
                                className="automation-history-row"
                                disabled={!run.threadId}
                                key={run.id}
                                onClick={() =>
                                  run.threadId &&
                                  props.onOpenThread(run.threadId)
                                }
                                variant="quiet"
                              >
                                <span
                                  className={`automation-run-dot ${run.state}`}
                                />
                                <span>
                                  {formatDate(run.scheduledFor, props.locale)}
                                </span>
                                <span>
                                  {statusText(props.locale, run.state)}
                                </span>
                                {run.reason && <small>{run.reason}</small>}
                              </Button>
                              {run.state === "failed" && (
                                <Button
                                  disabled={
                                    busy ||
                                    automation.authorizationState === "required"
                                  }
                                  size="compact"
                                  variant="quiet"
                                  icon={<ArtemisIcon name="refresh" />}
                                  onClick={() =>
                                    void invoke(() =>
                                      window.artemis.runAutomationNow(
                                        automation.id,
                                      ),
                                    )
                                  }
                                >
                                  {uiText(props.locale, "App_copy.queueRetry")}
                                </Button>
                              )}
                            </div>
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
      </div>

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
        {moreRecord && (
          <Button
            variant="quiet"
            icon={<ArtemisIcon name={moreRecord.enabled ? "pause" : "play"} />}
            disabled={busy}
            onClick={() => {
              setMoreAutomation(undefined);
              void invoke(() =>
                window.artemis.setAutomationEnabled(
                  moreRecord.id,
                  !moreRecord.enabled,
                ),
              );
            }}
          >
            {moreRecord.enabled ? t.pauseTask : t.enableTask}
          </Button>
        )}
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
