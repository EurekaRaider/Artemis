import { isExecutionMode } from "@artemis/protocol";
import { statusText } from "../../shared/i18n/status-text.js";
import { randomUUID } from "node:crypto";
import { dialog, Notification } from "electron";
import type {
  ApprovalResolution,
  Automation,
  AutomationEvent,
  AutomationRun,
  BrokerExecutionRequest,
  RiskLevel,
} from "@artemis/protocol";
import {
  PROTOCOL_VERSION,
  automationScheduleSchema,
  automationSchema,
  automationTargetSchema,
  runModeSchema,
} from "@artemis/protocol";
import {
  automationAuthorizationFingerprint,
  automationMayAutoApprove,
} from "../automation/automation-authorization.js";
import {
  nextAutomationOccurrence,
  validateAutomationSchedule,
} from "../automation/automation-schedule.js";
import { mainText } from "../settings/i18n.js";
import { I18N_RESOURCES } from "../../shared/i18n/i18n-resources.js";
import { IPC, type SaveAutomationInput } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "mainWindow"
  | "store"
  | "activeTurns"
  | "emitPayload"
  | "resolveModelSelection"
  | "automationScheduler"
  | "currentLocale"
>;
export function createAutomationController(services: Dependencies) {
  const { activeTurns, emitPayload, resolveModelSelection, currentLocale } =
    services;
  function publishAutomationEvent(event: AutomationEvent): void {
    services.mainWindow?.webContents.send(IPC.automationEvent, event);
  }

  function publishAutomationRun(run: AutomationRun | undefined): void {
    if (!run) return;
    publishAutomationEvent({
      protocolVersion: PROTOCOL_VERSION,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: { type: "automation-run.upserted", run },
    });
    if (
      services.store &&
      (run.state === "failed" ||
        run.state === "skipped" ||
        (run.state === "completed" && !services.mainWindow?.isFocused()))
    ) {
      const automation = services.store.getAutomation(run.automationId);
      if (automation) automationRunNotification(automation, run);
    }
  }

  function automationAutoApproval(request: BrokerExecutionRequest): boolean {
    if (!services.store) return false;
    const run = services.store.getAutomationRunForThread(request.threadId);
    const automation = run
      ? services.store.getAutomation(run.automationId)
      : undefined;
    if (
      !run ||
      !automation ||
      automation.authorizationFingerprint !==
        automationAuthorizationFingerprint(automation)
    ) {
      return false;
    }
    return automationMayAutoApprove({
      automationMode: automation.mode,
      authorizationState: automation.authorizationState,
      linkedThreadId: run.threadId,
      requestThreadId: request.threadId,
      activeTurnId: activeTurns.get(request.threadId),
      requestTurnId: request.turnId,
    });
  }

  function createAutomationApproval(
    request: BrokerExecutionRequest,
    details: {
      summary: string;
      paths?: string[];
      network?: string[];
      risk: RiskLevel;
    },
  ): ApprovalResolution | undefined {
    if (!automationAutoApproval(request)) return undefined;
    const nonce = randomUUID();
    emitPayload(request.threadId, request.turnId, {
      type: "approval.requested",
      approvalId: request.approvalId,
      nonce,
      summary: details.summary,
      paths: details.paths ?? [],
      network: details.network ?? [],
      risk: details.risk,
      allowedScopes: ["once"],
      source: "automation",
    });
    return {
      approvalId: request.approvalId,
      nonce,
      approved: true,
      scope: "once",
      source: "automation",
    };
  }

  function automationUpserted(automation: Automation): void {
    publishAutomationEvent({
      protocolVersion: PROTOCOL_VERSION,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: { type: "automation.upserted", automation },
    });
  }

  function automationDeleted(automationId: string): void {
    publishAutomationEvent({
      protocolVersion: PROTOCOL_VERSION,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: { type: "automation.deleted", automationId },
    });
  }

  function scheduledNextRun(
    automation: Pick<Automation, "schedule" | "enabled">,
    now: string,
  ): string | undefined {
    if (!automation.enabled) return undefined;
    const next = nextAutomationOccurrence(automation.schedule, now);
    if (!next) {
      throw new Error("The enabled automation has no future occurrence.");
    }
    return next;
  }

  async function saveAutomation(
    input: SaveAutomationInput,
  ): Promise<Automation> {
    if (!services.store) throw new Error("Application store is not ready.");
    const project = services.store.getProject(input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);
    const current = input.id
      ? services.store.getAutomation(input.id)
      : undefined;
    if (input.id && !current)
      throw new Error(`Automation not found: ${input.id}`);
    if (current && current.projectId !== input.projectId) {
      throw new Error("An automation cannot move to another project.");
    }

    const now = new Date().toISOString();
    const schedule = automationScheduleSchema.parse(input.schedule);
    validateAutomationSchedule(schedule);
    const mode = runModeSchema.parse(input.mode);
    const target = automationTargetSchema.parse(input.target);
    const modelSelection = input.modelSelection
      ? (
          await resolveModelSelection(
            input.modelSelection,
            current?.modelSelection,
          )
        ).selection
      : current?.modelSelection;
    const draft = {
      projectId: input.projectId,
      prompt: input.prompt.trim(),
      mode,
      target,
      schedule,
      ...(modelSelection ? { modelSelection } : {}),
    };
    const fingerprint = automationAuthorizationFingerprint(draft);
    const authorizationRemainsValid =
      current?.authorizationState === "authorized" &&
      current.authorizationFingerprint === fingerprint;
    const requiresAuthorization = isExecutionMode(mode);
    const enabled =
      input.enabled && (!requiresAuthorization || authorizationRemainsValid);
    const nextRunAt = scheduledNextRun({ schedule, enabled }, now);
    const value = automationSchema.parse({
      id: current?.id ?? randomUUID(),
      projectId: input.projectId,
      name: input.name.trim(),
      prompt: draft.prompt,
      mode,
      target,
      ...(modelSelection ? { modelSelection } : {}),
      schedule,
      enabled,
      authorizationState: requiresAuthorization
        ? authorizationRemainsValid
          ? "authorized"
          : "required"
        : "not-required",
      ...(authorizationRemainsValid
        ? {
            authorizationFingerprint: current?.authorizationFingerprint,
            authorizedAt: current?.authorizedAt,
          }
        : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
      ...(current?.lastRunAt ? { lastRunAt: current.lastRunAt } : {}),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
    const saved = current
      ? services.store.updateAutomation(value)
      : services.store.createAutomation(value);
    automationUpserted(saved);
    await services.automationScheduler?.refresh();
    return saved;
  }

  async function setAutomationEnabled(
    id: string,
    enabled: boolean,
  ): Promise<Automation> {
    if (!services.store) throw new Error("Application store is not ready.");
    const current = services.store.getAutomation(id);
    if (!current || current.deletedAt) {
      throw new Error("Automation was not found.");
    }
    if (
      enabled &&
      isExecutionMode(current.mode) &&
      (current.authorizationState !== "authorized" ||
        current.authorizationFingerprint !==
          automationAuthorizationFingerprint(current))
    ) {
      throw new Error("Authorize this Execute automation before enabling it.");
    }
    const now = new Date().toISOString();
    const nextRunAt = scheduledNextRun(
      { schedule: current.schedule, enabled },
      now,
    );
    const updated = services.store.updateAutomation(
      automationSchema.parse({
        ...current,
        enabled,
        ...(nextRunAt ? { nextRunAt } : { nextRunAt: undefined }),
        updatedAt: now,
      }),
    );
    automationUpserted(updated);
    await services.automationScheduler?.refresh();
    return updated;
  }

  async function authorizeAutomation(
    id: string,
  ): Promise<Automation | undefined> {
    if (!services.store || !services.mainWindow) {
      throw new Error("Application window is not ready.");
    }
    const current = services.store.getAutomation(id);
    if (!current || current.deletedAt) {
      throw new Error("Automation was not found.");
    }
    if (!isExecutionMode(current.mode)) {
      return setAutomationEnabled(id, true);
    }
    const result = await dialog.showMessageBox(services.mainWindow, {
      type: "warning",
      title: mainText(currentLocale(), "authorizeAutomation"),
      message: mainText(currentLocale(), "automationWillRun", {
        name: current.name,
      }),
      detail: mainText(currentLocale(), "automationAuthorizationDetail"),
      buttons: [
        I18N_RESOURCES[currentLocale()].common.cancel,
        mainText(currentLocale(), "authorizeAndEnable"),
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return undefined;

    const now = new Date().toISOString();
    const updated = services.store.updateAutomation(
      automationSchema.parse({
        ...current,
        enabled: true,
        authorizationState: "authorized",
        authorizationFingerprint: automationAuthorizationFingerprint(current),
        authorizedAt: now,
        nextRunAt: scheduledNextRun(
          { schedule: current.schedule, enabled: true },
          now,
        ),
        updatedAt: now,
      }),
    );
    automationUpserted(updated);
    await services.automationScheduler?.refresh();
    return updated;
  }

  function automationRunNotification(
    automation: Automation,
    run: AutomationRun,
  ): void {
    // Task-backed terminal/interaction events use the shared unread notification path.
    if (
      run.threadId &&
      ["completed", "failed", "waiting-approval"].includes(run.state)
    )
      return;
    if (!Notification.isSupported()) return;
    const title =
      run.state === "completed"
        ? mainText(currentLocale(), "automationCompleted")
        : mainText(currentLocale(), "automationNeedsAttention");
    const notification = new Notification({
      title,
      body: `${automation.name}: ${run.reason ?? statusText(currentLocale(), run.state)}`,
    });
    notification.on("click", () => {
      if (!services.mainWindow) return;
      if (services.mainWindow.isMinimized()) services.mainWindow.restore();
      services.mainWindow.show();
      services.mainWindow.focus();
      if (run.threadId) {
        services.mainWindow.webContents.send(
          IPC.automationThreadOpen,
          run.threadId,
        );
      }
    });
    notification.show();
  }
  return {
    publishAutomationEvent,
    publishAutomationRun,
    automationAutoApproval,
    createAutomationApproval,
    automationUpserted,
    automationDeleted,
    scheduledNextRun,
    saveAutomation,
    setAutomationEnabled,
    authorizeAutomation,
    automationRunNotification,
  };
}
