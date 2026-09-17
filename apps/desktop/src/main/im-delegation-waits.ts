/** Durable IM dependencies; execution remains owned by the existing Pi turn path. */
export interface DelegatedTaskResult {
  id: string;
  threadId?: string;
  invocationId?: string;
  direction: string;
  state: string;
  envelope: { id: string };
  result?: string;
  text?: string;
  heartbeatAt?: number;
}
export interface DelegationWait {
  version: 1;
  id: string;
  threadId: string;
  originTurnId?: string;
  groupId: string;
  tasks: Array<{ id: string; attempt: string }>;
  continuation: string;
  deadline: number;
  heartbeatGraceUntil?: number;
  security: string;
  state: "waiting" | "ready" | "consumed" | "cancelled" | "interrupted";
  retryApproved?: boolean;
  results: DelegatedTaskResult[];
}
const terminal = new Set([
  "completed",
  "failed",
  "rejected",
  "cancelled",
  "timeout",
]);
export class ImDelegationWaits {
  constructor(
    private readonly store: {
      list(): DelegationWait[];
      put(wait: DelegationWait): void;
    },
  ) {}
  active(threadId?: string): DelegationWait[] {
    return this.store
      .list()
      .filter(
        (w) =>
          (!threadId || w.threadId === threadId) &&
          ["waiting", "ready"].includes(w.state),
      );
  }
  ensureAutomatic(
    id: string,
    threadId: string,
    groupId: string,
    task: DelegatedTaskResult,
    security: string,
    originTurnId?: string,
  ): void {
    // A replayed dispatch must not resurrect a consumed or cancelled attempt.
    if (
      this.store
        .list()
        .some(
          (w) =>
            w.threadId === threadId &&
            w.tasks.some(
              (t) => t.id === task.id && t.attempt === task.envelope.id,
            ),
        )
    )
      return;
    this.register(
      id,
      threadId,
      groupId,
      [task],
      task.text ??
        "Review the delegated result and respond to the latest user request.",
      security,
      undefined,
      originTurnId,
    );
  }
  revise(id: string, continuation: string, timeoutSeconds = 86400): void {
    const wait = this.active().find((w) => w.id === id);
    if (wait)
      this.store.put({
        ...wait,
        continuation,
        deadline: Date.now() + timeoutSeconds * 1000,
      });
  }
  register(
    id: string,
    threadId: string,
    groupId: string,
    tasks: DelegatedTaskResult[],
    continuation: string,
    security: string,
    timeoutSeconds = 86400,
    originTurnId?: string,
  ): DelegationWait {
    const previous = this.store.list().find((w) => w.id === id);
    if (previous) return previous;
    if (
      !tasks.length ||
      tasks.some((t) => t.threadId !== threadId || t.direction !== "outgoing")
    )
      throw new Error("Wait requires this coordinator's delegated tasks.");
    // A newer wait for the same attempt supersedes its old continuation.
    for (const w of this.active(threadId))
      if (w.tasks.some((t) => tasks.some((next) => next.id === t.id)))
        this.store.put({ ...w, state: "cancelled" });
    const wait: DelegationWait = {
      version: 1,
      id,
      threadId,
      ...(originTurnId ? { originTurnId } : {}),
      groupId,
      tasks: tasks.map((t) => ({ id: t.id, attempt: t.envelope.id })),
      continuation,
      deadline: Date.now() + timeoutSeconds * 1000,
      heartbeatGraceUntil: Date.now() + 180_000,
      security,
      state: "waiting",
      results: [],
    };
    this.store.put(wait);
    this.update(groupId, tasks);
    return this.store.list().find((w) => w.id === id)!;
  }
  update(groupId: string, tasks: DelegatedTaskResult[]): void {
    for (const w of this.active().filter(
      (w) => w.groupId === groupId && !w.retryApproved,
    )) {
      const results = w.tasks.flatMap((expected) => {
        const result = tasks.find(
          (t) =>
            t.id === expected.id &&
            t.envelope.id === expected.attempt &&
            t.threadId === w.threadId &&
            t.direction === "outgoing",
        );
        return result ? [result] : [];
      });
      const stale = (t: DelegatedTaskResult) =>
        !terminal.has(t.state) &&
        t.state !== "blocked" &&
        Date.now() >= (w.heartbeatGraceUntil ?? w.deadline) &&
        Date.now() - (t.heartbeatAt ?? 0) >= 180_000;
      if (
        (Date.now() >= w.deadline || results.some(stale)) &&
        (results.length !== w.tasks.length ||
          !results.every((t) => terminal.has(t.state)))
      ) {
        for (const expected of w.tasks) {
          const index = results.findIndex((t) => t.id === expected.id);
          if (index >= 0 && terminal.has(results[index]!.state)) continue;
          if (Date.now() < w.deadline && index >= 0 && !stale(results[index]!))
            continue;
          const expired = {
            id: expected.id,
            envelope: { id: expected.attempt },
            threadId: w.threadId,
            direction: "outgoing",
            state: "timeout",
            result:
              "Waiting deadline reached. Remote completion is unknown; the remote task has not been cancelled. Check status before retrying.",
          };
          if (index >= 0) results[index] = expired;
          else results.push(expired);
        }
      }
      const ready =
        results.some((t) => terminal.has(t.state) && t.state !== "completed") ||
        (results.length === w.tasks.length &&
          results.every((t) => terminal.has(t.state)));
      this.store.put({ ...w, results, state: ready ? "ready" : "waiting" });
    }
  }
  cancelTask(threadId: string, taskId: string): string[] {
    const cancelled: string[] = [];
    for (const w of this.store.list().filter((w) => w.threadId === threadId))
      if (w.tasks.some((t) => t.id === taskId)) {
        this.store.put({ ...w, state: "cancelled" });
        cancelled.push(w.id);
        if (w.originTurnId) cancelled.push(w.originTurnId);
      }
    return cancelled;
  }
  consume(id: string): void {
    const w = this.store.list().find((w) => w.id === id);
    if (w && w.state !== "cancelled" && w.state !== "interrupted")
      this.store.put({ ...w, state: "consumed" });
  }
  interrupted(threadId: string): DelegationWait[] {
    return this.store
      .list()
      .filter((w) => w.threadId === threadId && w.state === "interrupted");
  }
  interrupt(id: string): void {
    const wait = this.store.list().find((w) => w.id === id);
    if (wait) this.store.put({ ...wait, state: "interrupted" });
  }
  approveRetry(id: string): void {
    const wait = this.store.list().find((w) => w.id === id);
    if (!wait || wait.state !== "interrupted")
      throw new Error("Delegation is not awaiting a retry decision.");
    this.store.put({ ...wait, state: "ready", retryApproved: true });
  }
  continueWaiting(id: string): void {
    const wait = this.store
      .list()
      .find((w) => w.id === id && w.state === "interrupted");
    if (!wait || !wait.results.some((t) => t.state === "timeout"))
      throw new Error("Only unknown tasks can continue waiting.");
    this.store.put({
      ...wait,
      state: "waiting",
      retryApproved: false,
      results: [],
      deadline: Date.now() + 86400_000,
      heartbeatGraceUntil: Date.now() + 180_000,
    });
  }
}
