import { busy } from "./im-runtime-values.js";
import type { Binding, PendingAction } from "./im-runtime-types.js";
import { isExecutionMode } from "@artemis/protocol";

import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

import type { ImOutboundCandidate } from "@artemis/protocol";
import { ImPermissionError } from "./im-policy.js";

import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";

import {
  remoteInvocationSchema,
  remoteOperationSchema,
  type ImReply,
  type RemoteOperation,
  type RunMode,
} from "@artemis/protocol";

import { buildRemoteShellLaunch, runRemoteShell } from "./im-sandbox.js";
import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
export function createImLocalExecution(
  services: Pick<
    ImCoordinatorDependencies,
    | "get"
    | "groupContext"
    | "text"
    | "ops"
    | "refreshConnection"
    | "http"
    | "renewGroupTurn"
    | "checkContext"
    | "put"
    | "list"
    | "remove"
    | "secureContext"
    | "grant"
    | "cancelOperations"
    | "delegationSecurity"
    | "delegationWaits"
    | "cancelDelegationTask"
    | "starts"
    | "profile"
    | "activeProjectWrites"
    | "projectWrites"
    | "controllers"
    | "authorizeOperation"
    | "clearReplyStream"
    | "db"
    | "operateScoped"
    | "withProjectWrite"
    | "blockPermission"
    | "validatedSandboxes"
    | "windowsHelper"
  >,
) {
  async function prepareLocalTurn(
    threadId: string,
    turnId: string,
  ): Promise<void> {
    let binding = services.get<Binding>("bindings", threadId);
    if (!binding) return;
    if (!binding.parentThreadId && services.groupContext(binding).native)
      throw new Error(services.text("useGroupLocalCommand"));
    const thread = services.ops.thread(threadId);
    if (!thread || busy(thread))
      throw new Error("Cannot change execution context during an active turn.");
    if (binding.request.conversation.kind === "group") {
      await services.refreshConnection();
      const request = remoteInvocationSchema.parse(
        await (
          await services.http("/v1/device/group-context", "POST", {
            spaceId: binding.request.conversation.spaceId,
          })
        ).json(),
      );
      binding = { ...services.get<Binding>("bindings", threadId)!, request };
      binding = await services.renewGroupTurn(binding);
    }
    services.checkContext(binding);
    binding = {
      ...binding,
      request: {
        ...binding.request,
        locale: services.ops.locale?.() ?? "zh-CN",
      },
    };
    services.put("bindings", threadId, binding);
    if (!binding.privateLocal) services.put("subscriptions", threadId, true);
    services.put("local-turns", turnId, threadId);
    for (const action of services.list<PendingAction>("actions"))
      if (action.threadId === threadId)
        services.remove("actions", action.token);
  }

  async function renewGroupTurn(binding: Binding): Promise<Binding> {
    const threadId = binding.threadId;
    const next = {
      ...binding,
      security: services.secureContext(binding, "desktop"),
    };
    services.grant(next);
    const assertIdle = () => {
      const thread = services.ops.thread(threadId);
      if (!thread || busy(thread))
        throw new Error(
          "Cannot change execution context during an active turn.",
        );
    };
    assertIdle();
    services.cancelOperations(threadId);
    // Reopening lets the agent host select the session for the current readable
    // scope. Audience changes and narrowed scopes must not reuse old history.
    await services.ops.close(threadId);
    assertIdle();
    services.grant(next);
    if (
      services.delegationSecurity(binding) === services.delegationSecurity(next)
    )
      return next;
    for (const wait of services.delegationWaits.active(threadId))
      for (const task of wait.tasks)
        await services.cancelDelegationTask(threadId, task.id, false);
    services.remove("suspended-bindings", threadId);
    services.remove("delegation-resumed", threadId);
    for (const action of services.list<PendingAction>("actions"))
      if (action.threadId === threadId)
        services.remove("actions", action.token);
    for (const candidate of services.list<ImOutboundCandidate>(
      "outbound-candidates",
    )) {
      if (
        candidate.threadId !== threadId ||
        !["pending", "sending"].includes(candidate.state)
      )
        continue;
      services.put("outbound-candidates", candidate.id, {
        ...candidate,
        state: "expired",
      });
      services.remove("outbound-bodies", candidate.id);
    }
    for (const reply of services.list<ImReply>("outbox"))
      if (reply.taskId === threadId) services.remove("outbox", reply.id);
    next.renewedAfterSequence = services.ops
      .events(threadId)
      .reduce(
        (sequence, event) => Math.max(sequence, event.seq),
        binding.renewedAfterSequence ?? 0,
      );
    return next;
  }

  function reserveStart(
    threadId: string,
    mode: RunMode,
    remoteOrigin?: boolean,
  ): () => void {
    if (services.starts.has(threadId))
      throw new Error("Task is already starting a turn.");
    const thread = services.ops.thread(threadId),
      remote = remoteOrigin ?? !!services.profile(threadId);
    if (!thread) return () => {};
    if (
      isExecutionMode(mode) &&
      thread.projectId &&
      !remote &&
      services.activeProjectWrites.has(thread.projectId)
    )
      throw new Error(
        "Project is executing a remote write operation. Retry after it finishes.",
      );
    services.starts.set(threadId, {
      projectId: thread.projectId,
      remote,
      mode,
    });
    return () => {
      services.starts.delete(threadId);
    };
  }

  async function withProjectWrite<T>(
    threadId: string,
    operation: RemoteOperation,
    mode: RunMode,
    turnId: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const binding = services.get<Binding>("bindings", threadId)!;
    const projectId = binding.projectId!;
    const predecessor =
      services.projectWrites.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => current);
    services.projectWrites.set(projectId, tail);
    const controller = new AbortController();
    const controllers =
      services.controllers.get(threadId) ?? new Set<AbortController>();
    controllers.add(controller);
    services.controllers.set(threadId, controllers);
    try {
      // A cancelled waiter still releases its place only after its predecessor.
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", abort, { once: true });
        void predecessor.then(() => {
          controller.signal.removeEventListener("abort", abort);
          resolve();
        });
      });
      while (
        services.ops
          .threads()
          .some(
            (t) =>
              t.id !== threadId &&
              t.projectId === projectId &&
              isExecutionMode(t.mode) &&
              busy(t) &&
              !services.profile(t.id),
          ) ||
        [...services.starts.values()].some(
          (pending) =>
            pending.projectId === projectId &&
            isExecutionMode(pending.mode) &&
            !pending.remote,
        )
      ) {
        controller.signal.throwIfAborted();
        services.authorizeOperation(threadId, operation, mode, turnId);
        await wait(100, undefined, { signal: controller.signal });
      }
      controller.signal.throwIfAborted();
      services.authorizeOperation(threadId, operation, mode, turnId);
      services.activeProjectWrites.add(projectId);
      try {
        return await run();
      } finally {
        services.activeProjectWrites.delete(projectId);
      }
    } finally {
      release();
      void tail.then(() => {
        if (services.projectWrites.get(projectId) === tail)
          services.projectWrites.delete(projectId);
      });
      controllers.delete(controller);
      if (!controllers.size) services.controllers.delete(threadId);
    }
  }

  function cancelOperations(threadId: string): void {
    services.clearReplyStream(threadId);
    for (const controller of services.controllers.get(threadId) ?? [])
      controller.abort();
  }

  function deleteThread(threadId: string): void {
    // A live remote task must never lose its execution boundary.
    if (services.ops.thread(threadId))
      throw new Error("Delete the task before removing its IM state.");
    services.cancelOperations(threadId);
    services.db.exec("BEGIN IMMEDIATE");
    try {
      services.db
        .prepare(
          "UPDATE im_state SET value=json_remove(value,'$.threadId') WHERE namespace='selections' AND json_extract(value,'$.threadId')=?",
        )
        .run(threadId);
      for (const namespace of [
        "bindings",
        "suspended-bindings",
        "subscriptions",
        "progress-time",
        "permission-blocks",
        "full-local-output",
      ])
        services.remove(namespace, threadId);
      services.db
        .prepare(
          "DELETE FROM im_state WHERE namespace='local-turns' AND value=?",
        )
        .run(JSON.stringify(threadId));
      for (const action of services.list<PendingAction>("actions"))
        if (action.threadId === threadId)
          services.remove("actions", action.token);
      // Keep receipts and assignment links: redelivery must not recreate a deleted task.
      services.db.exec("COMMIT");
    } catch (error) {
      services.db.exec("ROLLBACK");
      throw error;
    }
  }

  async function operate(
    threadId: string,
    operationInput: RemoteOperation,
    mode: RunMode,
    callId: string,
    turnId?: string,
  ): Promise<unknown> {
    // Old task-wide denials must not freeze operations under the new policy.
    services.remove("permission-blocks", threadId);
    try {
      const operation = remoteOperationSchema.parse(operationInput);
      services.authorizeOperation(threadId, operation, mode, turnId);
      const run = () =>
        services.operateScoped(threadId, operation, mode, callId, turnId);
      return operation.action === "write" || operation.action === "shell"
        ? await services.withProjectWrite(
            threadId,
            operation,
            mode,
            turnId,
            run,
          )
        : await run();
    } catch (error) {
      const denied =
        error instanceof ImPermissionError
          ? error
          : ["EACCES", "EPERM"].includes(
                (error as NodeJS.ErrnoException).code ?? "",
              )
            ? new ImPermissionError(
                "system-denied",
                services.text("systemFileAccessDenied"),
              )
            : undefined;
      if (!denied) throw error;
      return services.blockPermission(threadId, denied, turnId);
    }
  }

  async function checkSandbox(workspace: string): Promise<void> {
    workspace = await realpath(workspace);
    if (services.validatedSandboxes.has(workspace)) return;
    const marker = "ARTEMIS_REMOTE_SANDBOX_READY";
    const command =
      process.platform === "win32"
        ? `Write-Output '${marker}'`
        : `printf ${marker}`;
    const result = await runRemoteShell(
      buildRemoteShellLaunch(
        workspace,
        command,
        false,
        process.platform,
        services.windowsHelper,
      ),
      new AbortController().signal,
      10,
    );
    if (result.exitCode !== 0 || result.output.trim() !== marker)
      throw new Error(
        services.text("sandboxVerificationFailed") +
          result.output.slice(0, 300),
      );
    const probe = await mkdtemp(join(tmpdir(), "artemis-im-sandbox-"));
    try {
      const outside = await realpath(probe),
        part = relative(workspace, outside);
      if (!part.startsWith("..") && !isAbsolute(part))
        throw new Error(
          "Project scope is too broad to verify remote filesystem isolation.",
        );
      const file = join(outside, "private-probe.txt"),
        secret = randomUUID();
      await writeFile(file, secret, { mode: 0o600 });
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      const attempt =
        process.platform === "win32"
          ? `Get-Content '${file.replaceAll("'", "''")}'; Set-Content '${file.replaceAll("'", "''")}' 'changed'`
          : `cat ${quote(file)}; printf changed > ${quote(file)}`;
      const denied = await runRemoteShell(
        buildRemoteShellLaunch(
          workspace,
          attempt,
          false,
          process.platform,
          services.windowsHelper,
        ),
        new AbortController().signal,
        10,
      );
      if (
        denied.output.includes(secret) ||
        (await readFile(file, "utf8")) !== secret
      )
        throw new Error(
          "Native sandbox failed project isolation checks. Remote Execute is unavailable.",
        );
      services.validatedSandboxes.add(workspace);
    } finally {
      await rm(probe, { recursive: true, force: true });
    }
  }
  const handlers = {
    prepareLocalTurn,
    renewGroupTurn,
    reserveStart,
    withProjectWrite,
    cancelOperations,
    deleteThread,
    operate,
    checkSandbox,
  };
  return handlers;
}
