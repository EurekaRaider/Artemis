import { objective, terminal } from "./cooperation-values.js";
import type { NativeTask } from "./cooperation-types.js";

import { collaborationCommandSchema } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import type {
  CollaborationCommand,
  RemoteInvocationContext,
} from "@artemis/protocol";
import { digest } from "../../store.js";

import type { CooperationDependencies } from "./cooperation-dependencies.js";
export function createCooperationCommands(
  services: Pick<
    CooperationDependencies,
    | "group"
    | "router"
    | "peers"
    | "allowed"
    | "tasks"
    | "task"
    | "store"
    | "saveTask"
    | "now"
    | "frame"
    | "send"
    | "sessionKey"
  >,
) {
  function command(
    request: RemoteInvocationContext,
    threadId: string,
    id: string,
    command: CollaborationCommand,
  ): unknown {
    const group = services.group(request.conversation.spaceId!);
    command = collaborationCommandSchema.parse(command);
    if (
      !services.router.isInvocationAuthorized(
        request,
        command.action === "cancel",
      )
    )
      throw new Error("Authorization revoked.");
    if (command.action === "participants")
      return services
        .peers(group.id)
        .filter((p) => services.allowed(group, p.id));
    if (command.action === "status")
      return services
        .tasks(group.id)
        .filter(
          (t) => t.invocationId === request.id && t.threadId === threadId,
        );
    const parent = request.nativeTaskId
      ? services.task(group.id, request.nativeTaskId)
      : undefined;
    if (
      command.action !== "cancel" &&
      request.nativeTaskId &&
      (!parent ||
        parent.direction !== "incoming" ||
        parent.groupId !== group.id ||
        terminal(parent.state))
    )
      throw new Error("The parent assignment is no longer active.");
    const key = JSON.stringify([request.id, threadId, id]);
    const previous = services.store.get<{
      command: CollaborationCommand;
      result: unknown;
    }>("native-commands", key);
    if (previous) {
      if (JSON.stringify(previous.command) !== JSON.stringify(command))
        throw new Error("Command ID already used.");
      return previous.result;
    }
    return services.store.transaction(() => {
      const workflowKey = JSON.stringify([request.id, threadId]);
      const workflow = services.store.get<{ id: string }>(
        "native-workflows",
        workflowKey,
      ) ?? { id: parent?.workflow ?? randomUUID() };
      let result: unknown;
      if (command.action === "cancel") {
        const task = services.task(group.id, command.taskId ?? "");
        if (
          !task ||
          task.invocationId !== request.id ||
          task.threadId !== threadId ||
          task.direction !== "outgoing"
        )
          throw new Error("Task is not owned by this workflow.");
        if (!terminal(task.state) && task.state !== "cancel-sent") {
          if (task.state === "blocked")
            services.saveTask({
              ...task,
              state: "cancelled",
              updatedAt: services.now(),
            });
          else {
            const cancel = services.frame(
              group,
              task.peer,
              "cancel",
              "",
              task.id,
              task.workflow,
            );
            if (task.envelope.locale) cancel.locale = task.envelope.locale;
            // This authenticated, ownership-checked frame contains no task data.
            // It remains deliverable when the original data grant has expired.
            services.send(group, cancel);
            services.saveTask({
              ...task,
              state: "cancel-sent",
              cancelId: cancel.id,
              updatedAt: services.now(),
            });
          }
        }
        result = services.task(group.id, task.id);
      } else if (
        command.action === "delegate" ||
        command.action === "delegate-many"
      ) {
        const assignments =
          command.action === "delegate"
            ? [
                {
                  participantId: command.participantId!,
                  text: command.text,
                  dependsOn: [] as string[],
                  dependency: command.dependency,
                },
              ]
            : (command.assignments ?? []);
        if (!assignments.length)
          throw new Error("At least one assignment is required.");
        const tasks: NativeTask[] = [];
        for (const assignment of assignments) {
          if (!services.allowed(group, assignment.participantId)) {
            if (group.participants[0]?.identity.channel === "feishu")
              throw new Error(
                !group.nativeGroup?.allowedBots?.includes(
                  assignment.participantId,
                )
                  ? "Bot is not authorized. Ask the group owner to enable collaboration for this bot in the group member list."
                  : "Bot communication is not verified. Use verification retry in the group member list; check both apps' bot-message permissions and connections if it times out.",
              );
            throw new Error("Bot is not authorized or verified.");
          }
          if (parent && !assignment.dependency)
            throw new Error(
              "A dependency must explain why this peer is needed and what work you retain. Complete the original assignment yourself; do not return it unchanged.",
            );
          const ancestors = parent
            ? [
                ...(parent.envelope.ancestors ?? []),
                {
                  task: parent.id,
                  sender: parent.peer,
                  objective: objective(parent.text),
                },
              ]
            : [];
          if (ancestors.length > 16)
            throw new Error(
              "Collaboration dependency chain is too deep; resolve existing dependencies first.",
            );
          if (
            ancestors.some(
              (a) =>
                a.sender === assignment.participantId &&
                a.objective === objective(assignment.text),
            )
          )
            throw new Error(
              "Do not delegate the original assignment back to its sender. Request only a distinct missing input or prerequisite and retain your own responsibility.",
            );
          if (
            parent &&
            services
              .tasks(group.id)
              .some(
                (t) =>
                  t.direction === "outgoing" &&
                  t.envelope.parentTask === parent.id &&
                  t.peer === assignment.participantId &&
                  !terminal(t.state) &&
                  objective(t.text) === objective(assignment.text),
              )
          )
            throw new Error(
              "This dependency is already pending. Wait for its result instead of dispatching it again.",
            );
          const dependencies = [...(assignment.dependsOn ?? [])];
          if (
            dependencies.some(
              (dep) =>
                !services
                  .tasks(group.id)
                  .some(
                    (t) =>
                      t.id === dep &&
                      t.workflow === workflow.id &&
                      t.direction === "outgoing",
                  ),
            )
          )
            throw new Error(
              "Dependencies must reference existing tasks in this workflow.",
            );
          const envelope = services.frame(
            group,
            assignment.participantId,
            "delegate",
            assignment.text,
            randomUUID(),
            workflow.id,
          );
          if (request.locale) envelope.locale = request.locale;
          if (command.newTask) envelope.newTask = true;
          if (parent) {
            envelope.parentTask = parent.id;
            envelope.dependency = assignment.dependency;
            envelope.ancestors = ancestors;
          }
          // All authorized human senders share the group's current peer session.
          // Keep the device, group revision, peer, project and grant boundaries.
          const sessionKey = services.sessionKey(
            request,
            group,
            assignment.participantId,
          );
          let sessionId = envelope.task;
          let sessionReason: NativeTask["sessionReason"] = command.newTask
            ? "explicit-new"
            : "first-assignment";
          if (!command.newTask) {
            const selected = services.store.get<string>(
              "native-sessions-v3",
              sessionKey,
            );
            const previous = selected
              ? services.task(group.id, selected)
              : services
                  .tasks(group.id)
                  .filter((t) => {
                    if (
                      t.direction !== "outgoing" ||
                      t.peer !== assignment.participantId
                    )
                      return false;
                    if (t.sessionKey) {
                      if (t.sessionKey === sessionKey) return true;
                      // v2 also keyed by the human originator. Migrate the
                      // latest matching group session without importing an old
                      // group revision, project or permission snapshot.
                      const legacy = JSON.parse(t.sessionKey) as unknown[];
                      return (
                        legacy.length === 8 &&
                        JSON.stringify([
                          ...legacy.slice(0, 3),
                          ...legacy.slice(4),
                        ]) === sessionKey
                      );
                    }
                    // Only migrate legacy entries from this coordinator; old
                    // records did not explicitly identify a shared session.
                    const prior = services.store.get<RemoteInvocationContext>(
                      "invocations",
                      t.invocationId,
                    );
                    return (
                      t.threadId === threadId &&
                      prior &&
                      services.sessionKey(prior, group, t.peer) === sessionKey
                    );
                  })
                  .sort((a, b) => b.updatedAt - a.updatedAt)[0];
            if (selected && !previous)
              throw new Error(
                "The saved peer session is missing. Use newTask:true to explicitly start a new conversation.",
              );
            if (previous) {
              // A reverse prerequisite must run inside the waiting ancestor's
              // session; making it depend on that ancestor would deadlock both bots.
              const returning =
                !terminal(previous.state) &&
                ancestors.some((ancestor) => ancestor.task === previous.id);
              if (!terminal(previous.state) && !returning) {
                if (
                  parent ||
                  dependencies.length ||
                  tasks.some((t) => t.peer === assignment.participantId)
                ) {
                  if (!dependencies.includes(previous.id))
                    dependencies.push(previous.id);
                } else {
                  throw new Error(
                    "Wait for the peer's result before continuing. Use newTask:true only when the user explicitly requests a new conversation.",
                  );
                }
              }
              if (previous.state !== "rejected") {
                if (!returning) {
                  envelope.action = "continue";
                  envelope.previousTask = previous.id;
                }
                sessionId = previous.sessionId ?? previous.id;
                sessionReason = "continued";
              } else {
                if (previous.envelope.action === "continue")
                  throw new Error(
                    "The peer could not resume the saved conversation. Use newTask:true only after confirming a fresh conversation.",
                  );
                sessionReason = "previous-rejected";
              }
            }
          }
          const task: NativeTask = {
            version: 1,
            id: envelope.task,
            sessionId,
            sessionKey,
            sessionReason,
            groupId: group.id,
            workflow: workflow.id,
            peer: assignment.participantId,
            direction: "outgoing",
            state: dependencies.length ? "blocked" : "sent",
            text: assignment.text,
            invocationId: request.id,
            threadId,
            envelope,
            dependencies,
            sequence: 0,
            updatedAt: services.now(),
          };
          services.saveTask(task);
          services.store.put("native-sessions-v3", sessionKey, task.id);
          tasks.push(task);
          if (!dependencies.length) services.send(group, envelope, request.id);
        }
        services.store.put("native-workflows", workflowKey, {
          id: workflow.id,
        });
        result = tasks;
      } else if (command.action === "message") {
        const task = services.task(group.id, command.taskId ?? "");
        if (
          !task ||
          task.invocationId !== request.id ||
          task.threadId !== threadId ||
          task.direction !== "outgoing" ||
          !services.allowed(group, task.peer)
        )
          throw new Error("Select this workflow's task before sending a note.");
        if (!["accepted", "running"].includes(task.state))
          throw new Error(
            "Notes require an accepted, active task. A note cannot start execution or request a reply. Check status before retrying; use delegate for work, and newTask:true only when the user explicitly requests a new conversation.",
          );
        const note = services.frame(
          group,
          task.peer,
          "note",
          command.text,
          task.id,
          task.workflow,
        );
        if (task.envelope.locale) note.locale = task.envelope.locale;
        services.send(group, note, request.id);
        result = {
          state: "note-queued",
          taskId: task.id,
          startsExecution: false,
          instruction:
            "This note only appends to the task history; it does not request a reply or start execution. Do not wait for a new result from this note. Use delegate for work that needs execution or a reply.",
        };
      } else if (command.action === "finish") {
        const tasks = services
          .tasks(group.id)
          .filter(
            (t) =>
              t.workflow === workflow.id &&
              t.direction === "outgoing" &&
              t.invocationId === request.id &&
              t.threadId === threadId,
          );
        if (
          !tasks.length ||
          tasks.some((t) => t.state !== "completed" || !t.result?.trim())
        )
          throw new Error("Wait for all successful results before finishing.");
        if (!command.text.trim()) throw new Error("A summary is required.");
        if (parent) {
          result = { state: "summary-ready", text: command.text };
          services.store.put("native-commands", key, { command, result });
          return result; // The worker's final response completes its own parent.
        }
        services.router.queueDelivery(`native-summary:${digest(key)}`, {
          conversation: request.conversation,
          invocationId: request.id,
          text: command.text,
          mentionUserId: (request.originator ?? request.identity).userId,
        });
        result = { state: "summary-queued", workflow: workflow.id };
      } else
        throw new Error(
          "Use delegate, delegate-many, status or cancel for native IM cooperation.",
        );
      services.store.put("native-commands", key, { command, result });
      return result;
    });
  }
  const handlers = { command };
  return handlers;
}
