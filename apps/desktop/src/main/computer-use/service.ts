import { isExecutionMode } from "@artemis/protocol";
import { createHash, randomUUID } from "node:crypto";
import {
  COMPUTER_USE_VERSION,
  computerActSchema,
  computerOpenSchema,
  computerTargetSchema,
  computerBrowserDebugSchema,
  type BrowserPreviewCommand,
  type BrowserPreviewSnapshot,
  type ComputerAction,
  type ComputerAct,
  type ComputerControlState,
  type ComputerFrame,
  type ComputerObservation,
  type ComputerOpen,
  type ComputerTarget,
  type RunMode,
} from "@artemis/protocol";

export interface ComputerContext {
  threadId: string;
  turnId: string;
  mode: RunMode;
}
export interface ComputerDriver {
  targets(context: ComputerContext): Promise<ComputerTarget[]>;
  open(
    input: ComputerOpen,
    context: ComputerContext,
    signal: AbortSignal,
  ): Promise<ComputerTarget>;
  observe(
    target: ComputerTarget,
    image: boolean,
    signal: AbortSignal,
    allowForeground?: boolean,
  ): Promise<ComputerFrame>;
  act(
    target: ComputerTarget,
    action: ComputerAction,
    signal: AbortSignal,
    allowForeground?: boolean,
  ): Promise<void>;
  release(target: ComputerTarget): Promise<void>;
  debug?(
    target: ComputerTarget,
    command: BrowserPreviewCommand,
    signal: AbortSignal,
  ): Promise<BrowserPreviewSnapshot>;
}
interface Lease {
  target: ComputerTarget;
  context: ComputerContext;
  controller: AbortController;
  observation?: ComputerObservation;
  busy: boolean;
  allowForeground?: boolean;
}

function remainingControlsUnchanged(
  before: ComputerFrame,
  after: ComputerFrame,
  actions: ComputerAction[],
) {
  if (!before.scopeRevision || before.scopeRevision !== after.scopeRevision)
    return false;
  return actions.every((action) => {
    if (!("elementId" in action)) return false;
    const previous = before.elements.find(
      (element) => element.id === action.elementId,
    );
    const current = after.elements.find(
      (element) => element.id === action.elementId,
    );
    return (
      previous &&
      current &&
      previous.role === current.role &&
      previous.label === current.label &&
      JSON.stringify(previous.bounds) === JSON.stringify(current.bounds)
    );
  });
}
export class ComputerUseService {
  private readonly leases = new Map<string, Lease>();
  private readonly opening = new Map<
    string,
    {
      controller: AbortController;
      context: ComputerContext;
      target?: ComputerTarget;
    }
  >();
  private readonly pausedTurns = new Map<
    string,
    { turnId: string; reason: string }
  >();
  private state: ComputerControlState = {
    version: COMPUTER_USE_VERSION,
    state: "idle",
  };
  constructor(
    private readonly options: {
      drivers: Record<ComputerTarget["kind"], ComputerDriver>;
      authorize(
        target: ComputerTarget,
        context: ComputerContext,
        signal: AbortSignal,
      ): Promise<boolean>;
      foregroundGranted?(
        target: ComputerTarget,
        context: ComputerContext,
      ): boolean;
      authorizeForeground?(
        target: ComputerTarget,
        context: ComputerContext,
        signal: AbortSignal,
      ): Promise<boolean>;
      publish(state: ComputerControlState): void;
    },
  ) {}

  hasTargets(): boolean {
    return this.leases.size > 0 || this.opening.size > 0;
  }
  status(context?: ComputerContext): ComputerControlState {
    const paused = context && this.pausedTurns.get(context.threadId);
    if (context && paused?.turnId === context.turnId)
      return {
        version: COMPUTER_USE_VERSION,
        state: "paused",
        threadId: context.threadId,
        reason: paused.reason,
        ...(this.state.threadId === context.threadId && this.state.target
          ? { target: structuredClone(this.state.target) }
          : {}),
      };
    return structuredClone(this.state);
  }
  previewTarget(threadId: string, targetId?: string) {
    const lease = [...this.leases.values()].find(
      (value) =>
        value.context.threadId === threadId &&
        (!targetId || value.target.id === targetId) &&
        value.observation &&
        !value.controller.signal.aborted,
    );
    return (
      lease && { target: { ...lease.target }, context: { ...lease.context } }
    );
  }
  targetForApproval(
    input: ComputerAct,
    context: ComputerContext,
  ): ComputerTarget | undefined {
    try {
      const lease = this.lease(input.targetId, context);
      if (
        lease.busy ||
        lease.observation?.observationId !== input.observationId
      )
        return;
      return { ...lease.target };
    } catch {
      return;
    }
  }
  stopTargets(
    matches: (target: ComputerTarget) => boolean,
    threadId?: string,
    reason = "Permission revoked",
  ) {
    const affected = new Set<string>();
    for (const lease of [...this.leases.values(), ...this.opening.values()])
      if (
        lease.target &&
        matches(lease.target) &&
        (!threadId || lease.context.threadId === threadId)
      )
        affected.add(lease.context.threadId);
    for (const id of affected) this.stopThread(id, reason);
  }
  private publish(
    lease: Lease,
    state: ComputerControlState["state"],
    reason?: string,
  ) {
    this.state = {
      version: COMPUTER_USE_VERSION,
      state,
      threadId: lease.context.threadId,
      target: lease.target,
      ...(lease.observation?.foreground === undefined
        ? {}
        : { foreground: lease.observation.foreground }),
      ...(reason ? { reason } : {}),
    };
    this.options.publish(this.status());
  }
  private assertExecute(context: ComputerContext) {
    if (!isExecutionMode(context.mode))
      throw new Error(
        "Computer Use is available only in Work or Codemode mode.",
      );
  }
  private lease(id: string, context: ComputerContext): Lease {
    this.assertExecute(context);
    this.assertNotPaused(context);
    const lease = this.leases.get(id);
    if (
      !lease ||
      lease.context.threadId !== context.threadId ||
      lease.context.turnId !== context.turnId
    )
      throw new Error(
        "Target is not owned by this task and turn. Call computer_open first.",
      );
    lease.controller.signal.throwIfAborted();
    return lease;
  }
  private assertNotPaused(context: ComputerContext) {
    const paused = this.pausedTurns.get(context.threadId);
    if (paused?.turnId === context.turnId)
      throw new Error(
        `Computer Use is paused: ${paused.reason}. Wait for Resume or a new user turn; do not reopen or use Shell to bypass the pause.`,
      );
  }
  private async snapshot(
    lease: Lease,
    image = true,
  ): Promise<ComputerObservation> {
    const frame = await this.options.drivers[lease.target.kind].observe(
      lease.target,
      image,
      lease.controller.signal,
      lease.allowForeground === true,
    );
    lease.controller.signal.throwIfAborted();
    const observation: ComputerObservation = {
      ...frame,
      version: COMPUTER_USE_VERSION,
      target: lease.target,
      observationId: randomUUID(),
    };
    if (
      frame.image &&
      frame.visualRevision &&
      frame.visualRevision === lease.observation?.visualRevision
    ) {
      delete observation.image;
      observation.imageUnchanged = true;
    }
    lease.observation = observation;
    return observation;
  }
  async open(
    input: ComputerOpen,
    context: ComputerContext,
  ): Promise<ComputerObservation> {
    this.assertExecute(context);
    input = computerOpenSchema.parse(input);
    this.assertNotPaused(context);
    const kind =
      input.target === "browser" || input.target.startsWith("browser:")
        ? "browser"
        : "desktop";
    // Reserve desktop access before any asynchronous target lookup or permission dialog.
    const key = kind === "desktop" ? "desktop" : `browser:${context.threadId}`;
    if (this.opening.has(key))
      throw new Error("A target is already opening. Wait for that operation.");
    if (
      [...this.leases.values()].some(
        (lease) =>
          lease.busy &&
          lease.context.threadId === context.threadId &&
          lease.target.kind === kind,
      )
    )
      throw new Error(
        "A batch is already running. Wait before opening another target.",
      );
    if (
      [...this.leases.values()].some(
        (l) =>
          l.target.kind === kind &&
          (kind === "desktop" || l.context.threadId === context.threadId) &&
          l.context.threadId !== context.threadId,
      )
    )
      throw new Error("Desktop control is owned by another task.");
    const controller = new AbortController();
    this.opening.set(key, { controller, context });
    let target: ComputerTarget | undefined;
    let opened: Lease | undefined;
    try {
      target = await this.options.drivers[kind].open(
        input,
        context,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      this.opening.get(key)!.target = target;
      if (!(await this.options.authorize(target, context, controller.signal)))
        throw new Error("Application access denied by the user.");
      controller.signal.throwIfAborted();
      const existing = this.leases.get(target.id);
      if (existing && existing.context.threadId !== context.threadId)
        throw new Error("Target is owned by another task.");
      existing?.controller.abort();
      if (kind === "desktop") {
        for (const [id, previous] of this.leases)
          if (previous.target.kind === "desktop") {
            previous.controller.abort();
            this.leases.delete(id);
            await this.options.drivers.desktop.release(previous.target);
          }
      }
      const lease: Lease = {
        target,
        context,
        controller,
        busy: false,
        allowForeground:
          this.options.foregroundGranted?.(target, context) === true,
      };
      opened = lease;
      this.leases.set(target.id, lease);
      this.publish(lease, "observing");
      const observation = await this.snapshot(lease);
      this.publish(lease, "observing");
      return observation;
    } catch (error) {
      if (opened && this.leases.get(opened.target.id) === opened) {
        controller.abort();
        this.leases.delete(opened.target.id);
        await this.options.drivers[kind].release(opened.target);
        this.publish(
          opened,
          "paused",
          "Unable to observe the target. Reopen it to retry.",
        );
      }
      throw error;
    } finally {
      this.opening.delete(key);
      if (!this.hasTargets()) this.options.publish(this.status());
    }
  }
  async act(input: ComputerAct, context: ComputerContext) {
    input = computerActSchema.parse(input);
    const lease = this.lease(input.targetId, context);
    if (
      this.opening.has(
        lease.target.kind === "desktop"
          ? "desktop"
          : `browser:${context.threadId}`,
      )
    )
      throw new Error("A target is opening. Wait before acting.");
    if (lease.busy)
      throw new Error("A batch is already running for this target.");
    if (
      !lease.observation ||
      lease.observation.observationId !== input.observationId
    )
      throw new Error("Stale observation. Observe again before acting.");
    lease.busy = true;
    const driver = this.options.drivers[lease.target.kind];
    const signal = lease.controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let completed = 0;
    let attempted = 0;
    let stopped: string | undefined;
    let message: string | undefined;
    try {
      const needsForeground =
        lease.target.kind === "desktop" &&
        input.actions.some((action) =>
          ["key", "scroll", "click_at"].includes(action.type),
        );
      if (needsForeground && !lease.allowForeground) {
        const allowed = await this.options.authorizeForeground?.(
          lease.target,
          context,
          signal,
        );
        signal.throwIfAborted();
        if (!allowed)
          return {
            ...(await this.snapshot(lease)),
            status: "blocked" as const,
            attempted: 0,
            completed: 0,
            remaining: input.actions.length,
            stopped: "foreground-required",
            message:
              "Background control cannot perform these native actions. The user has not allowed foreground control. Stop here; do not retry or use Shell to activate the app.",
          };
        lease.allowForeground = true;
      }
      const deadline = performance.now() + 3000;
      timer = setTimeout(
        () =>
          lease.controller.abort(
            new Error(
              "Computer action exceeded 3 seconds. Resume control before retrying.",
            ),
          ),
        3000,
      );
      const coordinates = input.actions.some(
        (action) => action.type === "click_at",
      );
      const fresh = await driver.observe(
        lease.target,
        coordinates,
        signal,
        lease.allowForeground === true,
      );
      signal.throwIfAborted();
      if (fresh.revision !== lease.observation.revision)
        throw new Error("Stale interface. Observe again before acting.");
      if (
        coordinates &&
        (!fresh.visualRevision ||
          fresh.visualRevision !== lease.observation.visualRevision)
      )
        throw new Error(
          "Stale screenshot. Observe again before coordinate input.",
        );
      let before = fresh;
      for (const action of input.actions) {
        signal.throwIfAborted();
        if (performance.now() >= deadline) {
          stopped = "time-budget";
          break;
        }
        if (completed > 0 && action.type === "click_at") {
          stopped = "observe-required";
          break;
        }
        if (
          "elementId" in action &&
          !before.elements.some((e) => e.id === action.elementId)
        )
          throw new Error("Element is absent from the current observation.");
        if (
          action.type === "click_at" &&
          (action.x >= before.width || action.y >= before.height)
        )
          throw new Error("Coordinates are outside the observed target.");
        if (
          lease.target.kind === "desktop" &&
          ["key", "scroll", "click_at"].includes(action.type)
        )
          lease.observation.foreground = true;
        this.publish(lease, "acting");
        attempted++;
        try {
          await driver.act(
            lease.target,
            action,
            signal,
            lease.allowForeground === true,
          );
        } catch (error) {
          signal.throwIfAborted();
          stopped = "action-failed";
          message = error instanceof Error ? error.message : String(error);
          break;
        }
        signal.throwIfAborted();
        const after = await driver.observe(
          lease.target,
          false,
          signal,
          lease.allowForeground === true,
        );
        signal.throwIfAborted();
        if (action.type === "fill") {
          const field = after.elements.find((e) => e.id === action.elementId);
          const verified = field?.valueDigest
            ? field.valueDigest ===
              createHash("sha256").update(action.text).digest("hex")
            : field?.value === action.text;
          if (!verified) {
            stopped = "verification-failed";
            break;
          }
        }
        if (action.type === "click") {
          const previous = before.elements.find(
            (e) => e.id === action.elementId,
          );
          const current = after.elements.find((e) => e.id === action.elementId);
          if (
            previous?.role === "checkbox" &&
            previous.checked !== undefined &&
            current?.checked === previous.checked
          ) {
            stopped = "verification-failed";
            break;
          }
        }
        completed++;
        if (
          completed < input.actions.length &&
          after.revision !== before.revision &&
          !(
            lease.target.kind === "desktop" &&
            remainingControlsUnchanged(
              before,
              after,
              input.actions.slice(completed),
            )
          )
        ) {
          stopped = "interface-changed";
          break;
        }
        before = after;
      }
      clearTimeout(timer);
      const observation = await this.snapshot(lease);
      this.publish(lease, "observing");
      return {
        ...observation,
        status: stopped ? ("partial" as const) : ("completed" as const),
        attempted,
        completed,
        remaining: input.actions.length - completed,
        ...(stopped ? { stopped } : {}),
        ...(message ? { message } : {}),
      };
    } catch (error) {
      if (signal.aborted && this.leases.get(lease.target.id) === lease)
        this.stopThread(
          context.threadId,
          signal.reason instanceof Error
            ? signal.reason.message
            : "Computer action stopped. Resume control before reopening the target.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      lease.busy = false;
    }
  }
  stopThread(threadId: string, reason = "Task stopped") {
    const finished = reason === "Released" || reason === "Turn ended";
    for (const opening of this.opening.values())
      if (opening.context.threadId === threadId) {
        opening.controller.abort(new Error(reason));
        if (!finished) {
          this.pausedTurns.set(threadId, {
            turnId: opening.context.turnId,
            reason,
          });
          this.state = {
            version: COMPUTER_USE_VERSION,
            state: "paused",
            threadId,
            reason,
            ...(opening.target ? { target: opening.target } : {}),
          };
          this.options.publish(this.status());
        }
      }
    for (const [id, lease] of this.leases) {
      if (lease.context.threadId !== threadId) continue;
      lease.controller.abort(new Error(reason));
      if (!finished)
        this.pausedTurns.set(threadId, {
          turnId: lease.context.turnId,
          reason,
        });
      this.leases.delete(id);
      this.publish(lease, "paused", reason);
      void this.options.drivers[lease.target.kind]
        .release(lease.target)
        .catch(() => {});
    }
    if (finished) this.resumeThread(threadId);
  }
  resumeThread(threadId: string) {
    this.pausedTurns.delete(threadId);
    if (this.state.threadId === threadId) {
      this.state = { version: COMPUTER_USE_VERSION, state: "idle" };
      this.options.publish(this.status());
    }
  }
  stopAll(reason = "Computer Use disabled") {
    for (const opening of this.opening.values())
      this.stopThread(opening.context.threadId, reason);
    for (const lease of [...this.leases.values()])
      this.stopThread(lease.context.threadId, reason);
  }
  stopDesktop(reason: string) {
    const opening = this.opening.get("desktop");
    if (opening) this.stopThread(opening.context.threadId, reason);
    for (const lease of [...this.leases.values()])
      if (lease.target.kind === "desktop")
        this.stopThread(lease.context.threadId, reason);
  }
  async call(
    name: string,
    args: Record<string, unknown>,
    context: ComputerContext,
  ): Promise<unknown> {
    this.assertExecute(context);
    switch (name) {
      case "computer_status":
        return this.status(context);
      case "computer_targets":
        return (
          await Promise.all(
            Object.values(this.options.drivers).map((d) => d.targets(context)),
          )
        ).flat();
      case "computer_open":
        return this.open(computerOpenSchema.parse(args), context);
      case "computer_act":
        return this.act(computerActSchema.parse(args), context);
      case "computer_browser_debug": {
        const input = computerBrowserDebugSchema.parse(args);
        const lease = this.lease(input.targetId, context);
        const driver = this.options.drivers[lease.target.kind];
        if (
          lease.target.kind !== "browser" ||
          !driver.debug ||
          input.command.action === "devtools"
        )
          throw new Error("This browser debug operation is unavailable to AI.");
        if (lease.busy)
          throw new Error("Wait for the current browser operation.");
        lease.busy = true;
        try {
          const result = await driver.debug(
            lease.target,
            input.command,
            lease.controller.signal,
          );
          lease.controller.signal.throwIfAborted();
          if (["viewport", "reload"].includes(input.command.action))
            delete lease.observation;
          return result;
        } finally {
          lease.busy = false;
        }
      }
      case "computer_observe": {
        const lease = this.lease(
          computerTargetSchema.parse(args).targetId,
          context,
        );
        if (lease.busy)
          throw new Error("A batch is running. Wait before observing.");
        const observation = await this.snapshot(lease);
        this.publish(lease, "observing");
        return observation;
      }
      case "computer_release": {
        const lease = this.lease(
          computerTargetSchema.parse(args).targetId,
          context,
        );
        this.stopThread(lease.context.threadId, "Released");
        return { released: true };
      }
      default:
        throw new Error("Unknown Computer Use tool.");
    }
  }
}
