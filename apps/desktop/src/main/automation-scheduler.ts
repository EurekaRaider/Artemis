import { randomUUID } from "node:crypto";

import {
  PROTOCOL_VERSION,
  automationEventSchema,
  type Automation,
  type AutomationEvent,
  type AutomationRun,
  type AutomationRunTrigger,
} from "@artemis/protocol";

import {
  latestAutomationOccurrence,
  nextAutomationOccurrence,
} from "./automation-schedule.js";
import type { AppStore } from "./store.js";

const MAX_TIMER_DELAY = 2_147_483_647;

export interface AutomationSchedulerOptions {
  store: AppStore;
  launch(
    automation: Automation,
    run: AutomationRun,
    linkThread: (threadId: string) => void,
  ): Promise<void>;
  now?: () => Date;
  onEvent?: (event: AutomationEvent) => void;
  notify?: (automation: Automation, run: AutomationRun) => void;
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private draining: Promise<void> | undefined;
  private readonly now: () => Date;

  constructor(private readonly options: AutomationSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.runDue();
    this.armTimer();
  }

  async runDue(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drainDue();
    try {
      await this.draining;
    } finally {
      this.draining = undefined;
    }
  }

  async runNow(automationId: string): Promise<AutomationRun> {
    const automation = this.options.store.getAutomation(automationId);
    if (!automation || automation.deletedAt) {
      throw new Error("Automation was not found.");
    }
    const now = this.now().toISOString();
    const run = await this.processOccurrence(
      automation,
      now,
      "manual",
      undefined,
      false,
    );
    if (!run) {
      throw new Error("Automation occurrence was already claimed.");
    }
    return run;
  }

  private async drainDue(): Promise<void> {
    const now = this.now().toISOString();
    for (const automation of this.options.store.listDueAutomations(now)) {
      const scheduledFor =
        automation.schedule.kind === "interval"
          ? automation.nextRunAt
          : latestAutomationOccurrence(automation.schedule, now);
      if (!scheduledFor) continue;
      const nextRunAt = nextAutomationOccurrence(automation.schedule, now);
      const trigger: AutomationRunTrigger =
        automation.nextRunAt === scheduledFor ? "schedule" : "catch-up";
      await this.processOccurrence(
        automation,
        scheduledFor,
        trigger,
        nextRunAt,
        true,
      );
    }
  }

  private async processOccurrence(
    automation: Automation,
    scheduledFor: string,
    trigger: AutomationRunTrigger,
    nextRunAt: string | undefined,
    advanceSchedule: boolean,
  ): Promise<AutomationRun | undefined> {
    let skipReason: string | undefined;
    if (this.options.store.hasActiveAutomationRun(automation.id)) {
      skipReason = "Another run of this automation is still active.";
    } else if (
      automation.target === "local" &&
      this.options.store.hasActiveLocalThread(automation.projectId)
    ) {
      skipReason = "The local project already has an active task.";
    } else if (
      automation.mode === "execute" &&
      automation.authorizationState !== "authorized"
    ) {
      skipReason = "Automation authorization is required.";
    }

    const now = this.now().toISOString();
    const candidate: AutomationRun = {
      id: randomUUID(),
      automationId: automation.id,
      scheduledFor,
      trigger,
      state: skipReason ? "skipped" : "starting",
      ...(skipReason ? { reason: skipReason } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const claimed = this.options.store.claimAutomationRun(candidate, {
      advanceSchedule,
      ...(nextRunAt ? { nextRunAt } : {}),
      disableAutomation: advanceSchedule && automation.schedule.kind === "once",
    });
    if (!claimed) return undefined;

    this.emitRun(claimed);
    const updatedAutomation = this.options.store.getAutomation(automation.id);
    if (updatedAutomation) this.emitAutomation(updatedAutomation);
    if (skipReason) {
      this.options.notify?.(updatedAutomation ?? automation, claimed);
      return claimed;
    }

    let linked = false;
    try {
      await this.options.launch(automation, claimed, (threadId) => {
        linked = true;
        const run = this.options.store.updateAutomationRun(claimed.id, {
          threadId,
        });
        this.emitRun(run);
      });
      if (!linked) {
        throw new Error("Scheduled task did not create a task thread.");
      }
      return this.options.store.getAutomationRun(claimed.id)!;
    } catch (error) {
      const failed = this.options.store.updateAutomationRun(claimed.id, {
        state: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
      this.emitRun(failed);
      this.options.notify?.(updatedAutomation ?? automation, failed);
      return failed;
    }
  }

  private armTimer(): void {
    if (!this.started) return;
    const next = this.options.store
      .listAutomations()
      .filter(
        (automation) =>
          automation.enabled && !automation.deletedAt && automation.nextRunAt,
      )
      .sort((left, right) =>
        left.nextRunAt!.localeCompare(right.nextRunAt!),
      )[0]?.nextRunAt;
    if (!next) return;
    const delay = Math.max(
      0,
      Math.min(
        MAX_TIMER_DELAY,
        new Date(next).getTime() - this.now().getTime(),
      ),
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
  }

  private emitAutomation(automation: Automation): void {
    this.options.onEvent?.(
      automationEventSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        eventId: randomUUID(),
        timestamp: this.now().toISOString(),
        payload: { type: "automation.upserted", automation },
      }),
    );
  }

  private emitRun(run: AutomationRun): void {
    this.options.onEvent?.(
      automationEventSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        eventId: randomUUID(),
        timestamp: this.now().toISOString(),
        payload: { type: "automation-run.upserted", run },
      }),
    );
  }
}
