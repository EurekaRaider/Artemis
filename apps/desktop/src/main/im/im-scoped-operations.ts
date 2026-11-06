import type { Binding, SuspendedBinding } from "./im-runtime-types.js";
import { isExecutionMode } from "@artemis/protocol";

import type {
  DelegationWait,
  DelegatedTaskResult,
} from "./im-delegation-waits.js";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { prepareImShellRuntime } from "./im-shell-runtime.js";
import {
  buildLocalImShellLaunch,
  readLocalImFile,
  writeLocalImFile,
} from "./im-local-access.js";
import { runWindowsImShell } from "./im-windows-files.js";
import { imScopeConfirmation } from "@artemis/protocol";
import {
  imAudience,
  requireImScope,
  authorizeImPath,
  authorizeImReadPath,
  ImPermissionError,
  inspectImOutbound,
  imContentHash,
  readImFile,
  writeImFile,
  imProjectedDirectory,
} from "./im-policy.js";

import { lstat, realpath } from "node:fs/promises";

import {
  remoteOperationSchema,
  type RemoteOperation,
  type RunMode,
} from "@artemis/protocol";

import {
  checkedRemotePath,
  runRemoteShell,
  buildScopedImShellLaunch,
  validateImShellScope,
} from "./im-sandbox.js";
import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
export function createImScopedOperations(
  services: Pick<
    ImCoordinatorDependencies,
    | "get"
    | "text"
    | "authorizeOperation"
    | "groupContext"
    | "delegationWaits"
    | "usesLocalGateway"
    | "fullLocalAccess"
    | "ops"
    | "checkContext"
    | "waitForDelegation"
    | "http"
    | "suspendedWait"
    | "interruptFailedWait"
    | "observedDelegation"
    | "put"
    | "hasDelegationWait"
    | "cancelDelegationTask"
    | "deliverySecurity"
    | "delegationSecurity"
    | "manage"
    | "config"
    | "windowsFiles"
    | "controllers"
    | "leaseUntil"
    | "windowsHelper"
  >,
) {
  async function operateScoped(
    threadId: string,
    operationInput: RemoteOperation,
    mode: RunMode,
    callId: string,
    turnId?: string,
  ): Promise<unknown> {
    const operation = remoteOperationSchema.parse(operationInput),
      binding = services.get<Binding>("bindings", threadId);
    const cancelled = () =>
      !!turnId &&
      !!services.get<boolean>(
        "cancelled-delegation-turns",
        JSON.stringify([threadId, turnId]),
      );
    if (cancelled())
      throw new Error(
        "The user cancelled this delegation turn. Do not retry or delegate again.",
      );
    if (!binding) throw new Error("Remote tool is unavailable in this task.");
    if (!binding.projectId)
      throw new Error(services.text("adhocNoRemoteTools"));
    const grant = services.authorizeOperation(
      threadId,
      operation,
      mode,
      turnId,
    );
    const revision = services.get<Binding>("bindings", threadId)?.security
      ?.revision;
    const assertCurrent = () => {
      const current = services.authorizeOperation(
        threadId,
        operation,
        mode,
        turnId,
      );
      if (
        services.get<Binding>("bindings", threadId)?.security?.revision !==
        revision
      )
        throw new Error(
          "Authorization changed during the operation. Retry with the current scope.",
        );
      return current;
    };
    if (operation.action === "participants") {
      const group = services.groupContext(binding);
      return {
        spaceId: group.spaceId,
        channel: binding.request.identity.channel,
        capability: group.capability ?? "manual",
        stale: group.stale,
        complete: group.roster?.complete ?? false,
        ...(group.roster?.error
          ? { error: group.roster.error }
          : !group.roster
            ? { error: "unavailable" }
            : {}),
        members: (group.roster?.members ?? []).map((member) => ({
          ...member,
          participantId: member.identity.userId,
        })),
      };
    }
    if (operation.action === "collaborate") {
      if (
        binding.request.nativeTaskId &&
        ((operation.command.action === "delegate" &&
          !operation.command.dependency) ||
          (operation.command.action === "delegate-many" &&
            operation.command.assignments?.some((a) => !a.dependency)))
      )
        throw new Error(
          "A received assignment may request a distinct dependency with reason and retainedWork; do not send the original work back.",
        );
      if (binding.request.collaboration && !binding.request.nativeTaskId)
        throw new Error(
          "Legacy assignments do not support nested IM collaboration.",
        );
      if (
        ["delegate", "delegate-many"].includes(operation.command.action) &&
        services.delegationWaits.interrupted(threadId).length &&
        !(
          turnId &&
          services.get<DelegationWait>("delegation-waits", turnId)
            ?.retryApproved
        )
      )
        throw new Error(
          "A delegation was interrupted. Ask the user to click Retry in Artemis; do not redispatch automatically.",
        );
      if (
        !services.usesLocalGateway() ||
        services.groupContext(binding).capability !== "events"
      ) {
        if (binding.request.identity.channel === "feishu")
          throw new Error(
            !services.usesLocalGateway()
              ? services.text("feishuLocalGateway")
              : services.text("botCollaborationUnauthorized"),
          );
        throw new Error(services.text("manualBotHandoff"));
      }
      const text =
        operation.command.action === "delegate-many"
          ? (operation.command.assignments?.map((a) => a.text).join("\n") ?? "")
          : operation.command.text;
      const reason = services.fullLocalAccess(binding)
        ? undefined
        : inspectImOutbound(text, services.ops.locale?.() ?? "zh-CN");
      if (reason) throw new Error(reason);
      services.checkContext(binding);
      if (operation.command.action === "wait")
        return services.waitForDelegation(
          binding,
          operation.command,
          callId,
          turnId,
        );
      let invocationId = binding.request.id;
      if (
        ["status", "message", "cancel", "finish"].includes(
          operation.command.action,
        )
      ) {
        const state = (await (
          await services.http("/v1/device/native-cooperation", "POST", {
            groupId: binding.request.conversation.spaceId,
            operation: "state",
          })
        ).json()) as { tasks: DelegatedTaskResult[] };
        const suspended =
          services.get<SuspendedBinding[]>("suspended-bindings", threadId) ??
          [];
        const tasks = state.tasks.filter(
          (t) =>
            t.threadId === threadId &&
            t.direction === "outgoing" &&
            !suspended.some(
              (entry) => entry.binding.request.id === t.invocationId,
            ),
        );
        if (operation.command.action === "status") {
          let delivered = false;
          // These results are being delivered to the current model turn. Do not
          // deliver them again through a separate automatic continuation.
          services.delegationWaits.update(
            binding.request.conversation.spaceId!,
            tasks,
          );
          for (const wait of services.delegationWaits.active(threadId)) {
            if (services.suspendedWait(wait.id, threadId)) continue;
            if (await services.interruptFailedWait(wait, false, turnId))
              return {
                state: "interrupted",
                parkDelegation: true,
                tasks: tasks.map((task) => services.observedDelegation(task)),
              };
            if (
              wait.state === "ready" &&
              wait.results.every((result) =>
                tasks.some(
                  (task) =>
                    task.id === result.id &&
                    task.envelope.id === result.envelope.id &&
                    task.state === result.state,
                ),
              )
            ) {
              services.put("delegation-resumed", threadId, wait.id);
              services.delegationWaits.consume(wait.id);
              delivered = true;
            }
          }
          if (cancelled())
            throw new Error("Delegation was cancelled by the user.");
          if (turnId && !delivered && services.hasDelegationWait(threadId))
            return {
              state: "waiting",
              parkDelegation: true,
              tasks: tasks.map((task) => services.observedDelegation(task)),
            };
          return tasks.map((task) => services.observedDelegation(task));
        }
        if (operation.command.taskId) {
          const task = tasks.find((t) => t.id === operation.command.taskId);
          if (!task?.invocationId)
            throw new Error("Task is not owned by this coordinator.");
          invocationId = task.invocationId;
        } else if (operation.command.action === "finish") {
          const resumed = services.get<string>("delegation-resumed", threadId);
          const wait = resumed
            ? services.get<DelegationWait>("delegation-waits", resumed)
            : undefined;
          const original = wait
            ? tasks.find((t) =>
                wait.tasks.some((expected) => expected.id === t.id),
              )
            : undefined;
          if (original?.invocationId) invocationId = original.invocationId;
        }
      }
      if (operation.command.action === "cancel")
        await services.cancelDelegationTask(
          threadId,
          operation.command.taskId!,
          !turnId,
        );
      if (operation.command.action !== "cancel" && cancelled())
        throw new Error("Delegation was cancelled by the user.");
      const result: unknown = await services
        .http("/v1/device/native-command", "POST", {
          id: callId,
          invocationId,
          threadId,
          command: operation.command,
          security: services.deliverySecurity(binding.security!),
        })
        .then((response) => response.json())
        .catch((error: unknown) => {
          if (operation.command.action === "cancel" && turnId)
            return {
              state: "cancel-failed",
              error: error instanceof Error ? error.message : String(error),
            };
          throw error;
        });
      if (
        ["delegate", "delegate-many"].includes(operation.command.action) &&
        Array.isArray(result)
      ) {
        for (const task of result as DelegatedTaskResult[]) {
          services.delegationWaits.ensureAutomatic(
            randomUUID(),
            threadId,
            binding.request.conversation.spaceId!,
            task,
            services.delegationSecurity(binding),
            turnId,
          );
          if (cancelled()) {
            await services.cancelDelegationTask(threadId, task.id);
            await services.manage({
              action: "native-cancel",
              groupId: binding.request.conversation.spaceId!,
              taskId: task.id,
              messageId: randomUUID(),
            });
          }
        }
      }
      if (operation.command.action === "cancel" && turnId)
        return { result, cancelDelegationTurn: true };
      return result;
    }
    const receiptKey = JSON.stringify([
      services.config.deviceId,
      threadId,
      binding.request.id,
      turnId,
      callId,
    ]);
    const previous = services.get<{
      state: string;
      operation: RemoteOperation;
      result?: unknown;
    }>("operations", receiptKey);
    if (previous) {
      if (JSON.stringify(previous.operation) !== JSON.stringify(operation))
        throw new Error(
          "Operation ID cannot be reused for a different action.",
        );
      if (previous.state === "done") return previous.result;
      throw new Error(
        "Previous operation outcome is uncertain. Check actual state before a new operation.",
      );
    }
    const project = services.ops
      .projects()
      .find((p) => p.id === binding.projectId);
    if (!project) throw new Error("Project no longer exists.");
    const workspace = await realpath(project.path);
    assertCurrent();
    const scope = requireImScope(
      grant,
      imAudience(binding.request.conversation),
      undefined,
      services.ops.locale?.() ?? "zh-CN",
    );
    const fullLocal =
      scope.localAccess === "full" &&
      !!imScopeConfirmation(grant.security, scope);
    if (fullLocal && operation.action === "read") {
      const result = await readLocalImFile(workspace, operation.path);
      assertCurrent();
      return result;
    }
    if (fullLocal && operation.action === "write") {
      services.put("operations", receiptKey, { state: "started", operation });
      await writeLocalImFile(
        workspace,
        operation.path,
        operation.content,
        () => assertCurrent(),
        operation.expectedHash,
      );
      const result = { output: "File written.", exitCode: 0, cancelled: false };
      services.put("operations", receiptKey, {
        state: "done",
        operation,
        result,
      });
      return result;
    }
    if (operation.action === "read") {
      const readPath = authorizeImReadPath(
        scope,
        operation.path,
        services.ops.locale?.() ?? "zh-CN",
      );
      const projected = imProjectedDirectory(scope, readPath);
      if (projected) return { entries: projected };
      const path =
        readPath === "."
          ? workspace
          : await checkedRemotePath(workspace, readPath);
      if ((await lstat(path)).isDirectory()) {
        if (scope.filePaths?.includes(operation.path))
          throw new Error(services.text("fileReplacedByDirectory"));
        if (services.windowsFiles) {
          return {
            entries: await services.windowsFiles.list(
              workspace,
              operation.path,
              scope,
              () => assertCurrent(),
            ),
          };
        }
        if (process.platform !== "darwin")
          throw new Error(services.text("fullFilePathRequired"));
        const quoted = `'${path.replaceAll("'", "'\\''")}'`;
        const result = await runRemoteShell(
          buildScopedImShellLaunch(
            workspace,
            `/bin/ls -1A ${quoted}`,
            false,
            {
              ...scope,
              writePaths: [],
            },
            undefined,
            undefined,
            undefined,
            services.ops.locale?.() ?? "zh-CN",
          ),
          new AbortController().signal,
          10,
        );
        assertCurrent();
        if (result.exitCode !== 0) {
          if (/Permission denied|Operation not permitted/iu.test(result.output))
            throw new ImPermissionError(
              "system-denied",
              services.text("directoryAccessDenied"),
            );
          throw new Error(services.text("directoryReadFailed"));
        }
        const entries = [];
        for (const name of result.output.split("\n").filter(Boolean)) {
          const item =
            operation.path === "." ? name : `${operation.path}/${name}`;
          try {
            const child = await checkedRemotePath(
              workspace,
              authorizeImPath(
                scope,
                item,
                undefined,
                services.ops.locale?.() ?? "zh-CN",
              ),
            );
            entries.push({
              path: item,
              directory: (await lstat(child)).isDirectory(),
            });
          } catch {
            /* Protected or linked children are not part of the listing. */
          }
        }
        assertCurrent();
        return { entries };
      }
      const bytes = services.windowsFiles
        ? await services.windowsFiles.read(
            workspace,
            operation.path,
            scope,
            () => assertCurrent(),
          )
        : await readImFile(
            workspace,
            operation.path,
            scope,
            undefined,
            services.ops.locale?.() ?? "zh-CN",
          );
      assertCurrent();
      return {
        output: bytes.toString("utf8"),
        contentHash: imContentHash(bytes),
        exitCode: 0,
        cancelled: false,
      };
    }
    if (operation.action === "write") {
      if (!isExecutionMode(mode)) throw new Error("Plan cannot write.");
      services.put("operations", receiptKey, { state: "started", operation });
      await (
        services.windowsFiles
          ? services.windowsFiles.write.bind(services.windowsFiles)
          : writeImFile
      )(
        workspace,
        operation.path,
        operation.content,
        scope,
        () => assertCurrent(),
        operation.expectedHash,
      );
      const result = { output: "File written.", exitCode: 0, cancelled: false };
      services.put("operations", receiptKey, {
        state: "done",
        operation,
        result,
      });
      return result;
    }
    const shellLinkPolicy = fullLocal
      ? undefined
      : await validateImShellScope(
          workspace,
          scope,
          services.ops.locale?.() ?? "zh-CN",
        );
    assertCurrent();
    const command = operation.command;
    const controller = new AbortController();
    const set =
      services.controllers.get(threadId) ?? new Set<AbortController>();
    set.add(controller);
    services.controllers.set(threadId, set);
    const expiry = setInterval(() => {
      if (
        Date.now() >=
        Math.min(
          binding.request.expiresAt,
          grant.expiresAt,
          services.leaseUntil,
        )
      )
        controller.abort();
    }, 500);
    services.put("operations", receiptKey, { state: "started", operation });
    let runtime: Awaited<ReturnType<typeof prepareImShellRuntime>> | undefined;
    try {
      runtime =
        !fullLocal && process.platform === "darwin"
          ? await prepareImShellRuntime()
          : undefined;
      assertCurrent();
      const result = fullLocal
        ? await runRemoteShell(
            buildLocalImShellLaunch(workspace, command),
            controller.signal,
            operation.timeoutSeconds,
          )
        : services.windowsFiles && services.windowsHelper
          ? await runWindowsImShell({
              locale: services.ops.locale?.() ?? "zh-CN",
              workspace,
              helper: services.windowsHelper,
              scope,
              command,
              network: grant.network,
              signal: controller.signal,
              timeoutSeconds: operation.timeoutSeconds,
              assertCurrent: () => {
                assertCurrent();
              },
            })
          : await runRemoteShell(
              buildScopedImShellLaunch(
                workspace,
                command,
                grant.network,
                scope,
                process.platform,
                shellLinkPolicy,
                runtime,
                services.ops.locale?.() ?? "zh-CN",
              ),
              controller.signal,
              operation.timeoutSeconds,
            );
      services.put("operations", receiptKey, {
        state: "done",
        operation,
        result,
      });
      if (
        result.exitCode !== 0 &&
        !result.cancelled &&
        /(?:^|: )(?:Permission denied|Operation not permitted)(?:\r?\n|$)/imu.test(
          result.output,
        )
      )
        throw new ImPermissionError(
          "system-denied",
          services.text("commandAccessDenied"),
        );
      return result;
    } finally {
      clearTimeout(expiry);
      set.delete(controller);
      if (!set.size) services.controllers.delete(threadId);
      await runtime?.dispose();
    }
  }
  const handlers = { operateScoped };
  return handlers;
}
