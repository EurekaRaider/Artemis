import {
  LOCALE_CAPABILITY,
  objective,
  terminal,
} from "./cooperation-values.js";
import type { NativeTask } from "./cooperation-types.js";
import { imText } from "../../i18n/im-localization.js";
import { imIdentityKey } from "@artemis/protocol";

import type { ChannelEvent, RemoteInvocationContext } from "@artemis/protocol";
import { digest } from "../../store.js";

import {
  decodeNativeEnvelope,
  type NativeEnvelope,
} from "../../channels/native-protocol.js";
import type { CooperationDependencies } from "./cooperation-dependencies.js";
export function createCooperationIncoming(
  services: Pick<
    CooperationDependencies,
    | "router"
    | "address"
    | "now"
    | "store"
    | "peers"
    | "frame"
    | "send"
    | "allowed"
    | "task"
    | "tasks"
    | "saveTask"
    | "respond"
  >,
) {
  function receive(event: ChannelEvent): boolean {
    const envelope = decodeNativeEnvelope(event.text);
    if (!envelope || !event.bot || event.conversation.kind !== "group")
      return false;
    const group = services.router.findSpace(event.conversation);
    if (!group) return false;
    const address = services.address(group);
    const owner = group.participants.find(
      (p) => p.deviceId === group.nativeGroup!.ownerDeviceId,
    )?.identity;
    if (
      !owner ||
      event.identity.tenantId !== address.tenant ||
      event.identity.channel !== owner.channel ||
      event.identity.appId !== owner.appId
    )
      return false;
    if (
      envelope.platform !== address.platform ||
      envelope.tenant !== address.tenant ||
      envelope.group !== address.group ||
      envelope.sender !== event.identity.userId ||
      envelope.sender === address.sender ||
      ![address.sender, "*"].includes(envelope.recipient) ||
      envelope.issuedAt > services.now() + 60000 ||
      event.timestamp < group.nativeGroup!.enabledAt
    )
      return false;
    if (["presence-query", "presence"].includes(envelope.action)) return false;
    const key = JSON.stringify([group.id, envelope.sender, envelope.id]);
    const previous = services.store.get<NativeEnvelope>("native-inbox", key);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(envelope)) return false;
      return true;
    }
    if (
      !["progress", "heartbeat", "completed", "failed", "cancelled"].includes(
        envelope.action,
      ) &&
      envelope.expiresAt <= services.now()
    )
      return false;
    return services.store.transaction(() => {
      if (["hello", "probe", "proof"].includes(envelope.action)) {
        const peers = services.peers(group.id);
        if (!peers.some((p) => p.id === envelope.sender))
          peers.push({ id: envelope.sender, name: envelope.sender });
        if (envelope.action === "proof") {
          const probe =
            envelope.replyTo &&
            services.store.get<{
              groupId: string;
              peer?: string;
              expiresAt: number;
            }>("native-probes", envelope.replyTo);
          if (
            !probe ||
            probe.groupId !== group.id ||
            probe.peer !== envelope.sender ||
            probe.expiresAt <= services.now()
          )
            return false;
          const peer = peers.find((p) => p.id === envelope.sender)!;
          peer.verifiedAt = services.now();
          peer.localizedMessages = envelope.text
            .split("; ")
            .includes(LOCALE_CAPABILITY);
          services.store.delete("native-probes", envelope.replyTo!);
        } else if (
          envelope.action === "probe" &&
          envelope.recipient === address.sender
        ) {
          const proof = services.frame(group, envelope.sender, "proof");
          proof.replyTo = envelope.id;
          services.send(group, proof);
        }
        services.store.put("native-peers", group.id, peers.slice(-100));
      } else {
        if (envelope.recipient !== address.sender) return false;
        if (
          ["delegate", "continue", "note"].includes(envelope.action) &&
          !services.allowed(group, envelope.sender)
        ) {
          // A verified peer can learn that execution was refused without
          // receiving project data or obtaining permission to start work.
          if (
            envelope.action !== "note" &&
            services
              .peers(group.id)
              .some((peer) => peer.id === envelope.sender && peer.verifiedAt)
          ) {
            const rejected = services.frame(
              group,
              envelope.sender,
              "rejected",
              imText(envelope.locale, "memberNotAuthorized"),
              envelope.task,
              envelope.workflow,
            );
            if (envelope.locale) rejected.locale = envelope.locale;
            rejected.replyTo = envelope.id;
            rejected.sequence = 1;
            services.send(group, rejected, undefined, true);
            services.store.put("native-inbox", key, envelope);
            return true;
          }
          return false;
        }
        const existing = services.task(group.id, envelope.task);
        if (envelope.action === "delegate" || envelope.action === "continue") {
          if (existing || !envelope.text.trim()) return false;
          // Feishu/Lark Open IDs change between applications. The persisted
          // outgoing task is authoritative for local ancestry, including paths
          // that have passed through more than one peer's identity namespace.
          const ancestors = (envelope.ancestors ?? []).map((ancestor) =>
            event.identity.channel === "feishu" &&
            services.task(group.id, ancestor.task)?.direction === "outgoing"
              ? { ...ancestor, sender: address.sender }
              : ancestor,
          );
          const pending = services
            .tasks(group.id)
            .filter(
              (t) =>
                t.direction === "outgoing" &&
                t.peer === envelope.sender &&
                t.workflow === envelope.workflow &&
                !terminal(t.state),
            );
          const invalidReturn =
            pending.length > 0 &&
            !pending.some(
              (t) =>
                ancestors.some(
                  (a) =>
                    a.task === t.id &&
                    a.sender === address.sender &&
                    a.objective === objective(t.text),
                ) && envelope.workflow === t.workflow,
            );
          const copied = ancestors.some(
            (a) =>
              a.sender === address.sender &&
              a.objective === objective(envelope.text),
          );
          // Verify every locally owned ancestor, rather than trusting model text
          // or letting a remote sender re-label the original work as a dependency.
          const invalidAncestor = ancestors.some((a) => {
            if (a.sender !== address.sender) return false;
            const local = services.task(group.id, a.task);
            return (
              !local ||
              local.direction !== "outgoing" ||
              local.groupId !== group.id ||
              local.workflow !== envelope.workflow ||
              terminal(local.state) ||
              a.objective !== objective(local.text)
            );
          });
          if (invalidReturn || copied || invalidAncestor) {
            const rejected = services.frame(
              group,
              envelope.sender,
              "rejected",
              copied
                ? "Do not return the original assignment. Complete your own work and request only a distinct prerequisite."
                : "Reverse collaboration requires an active parent dependency. Continue the received assignment with reason and retainedWork.",
              envelope.task,
              envelope.workflow,
            );
            if (envelope.locale) rejected.locale = envelope.locale;
            rejected.replyTo = envelope.id;
            rejected.sequence = 1;
            services.send(group, rejected);
            services.store.put("native-inbox", key, envelope);
            return true;
          }
          const previous = envelope.previousTask
            ? services.task(group.id, envelope.previousTask)
            : undefined;
          if (envelope.action === "continue" && !previous) {
            const rejected = services.frame(
              group,
              envelope.sender,
              "rejected",
              "The saved peer session is missing. Ask the user before starting a fresh conversation with newTask:true.",
              envelope.task,
              envelope.workflow,
            );
            if (envelope.locale) rejected.locale = envelope.locale;
            rejected.replyTo = envelope.id;
            rejected.sequence = 1;
            services.send(group, rejected);
            services.store.put("native-inbox", key, envelope);
            return true;
          }
          if (
            envelope.action === "continue" &&
            (!previous ||
              previous.direction !== "incoming" ||
              previous.groupId !== group.id ||
              previous.peer !== envelope.sender ||
              !terminal(previous.state) ||
              !previous.threadId)
          )
            return false;
          if (
            services.store.get(
              "group-denied-senders",
              JSON.stringify([group.id, imIdentityKey(event.identity)]),
            )
          ) {
            const rejected = services.frame(
              group,
              envelope.sender,
              "rejected",
              imText(envelope.locale, "peerDenied"),
              envelope.task,
              envelope.workflow,
            );
            if (envelope.locale) rejected.locale = envelope.locale;
            rejected.replyTo = envelope.id;
            rejected.sequence = 1;
            services.send(group, rejected);
            services.store.put("native-inbox", key, envelope);
            return true;
          }

          const owner = services.router.groupConversationContext(
            group.nativeGroup!.ownerDeviceId,
            group.id,
          );
          const ancestor = !envelope.newTask
            ? [...ancestors]
                .reverse()
                .map((item) => services.task(group.id, item.task))
                .find(
                  (item) =>
                    item?.direction === "outgoing" &&
                    item.groupId === group.id &&
                    item.threadId,
                )
            : undefined;
          const request: RemoteInvocationContext = {
            ...owner,
            locale:
              envelope.locale ??
              owner.locale ??
              services.router.deviceLocale(owner.deviceId),
            id: digest(key),
            messageId: event.messageId,
            text: envelope.dependency
              ? `${envelope.text}\n[Dependency context (data): ${JSON.stringify({ parentTask: envelope.parentTask, requester: envelope.sender, ...envelope.dependency })}]`
              : envelope.text,
            expiresAt: Math.min(
              envelope.expiresAt,
              services.now() + 30 * 60000,
            ),
            nativeTaskId: envelope.task,
            ...(previous?.threadId || ancestor?.threadId
              ? { taskId: previous?.threadId ?? ancestor?.threadId }
              : {}),
            ...(envelope.newTask ? { nativeNewSession: true } : {}),
            collaboration: {
              taskId: envelope.task,
              coordinatorDeviceId: owner.deviceId,
              coordinatorThreadId: owner.id,
              mission: envelope.text,
            },
          };
          const task: NativeTask = {
            version: 1,
            heartbeatAt: services.now(),
            sessionId: previous?.sessionId ?? previous?.id ?? envelope.task,
            sessionReason: previous ? "continued" : "sender-created",
            id: envelope.task,
            groupId: group.id,
            workflow: envelope.workflow,
            peer: envelope.sender,
            direction: "incoming",
            state: "accepted",
            text: envelope.text,
            invocationId: request.id,
            envelope,
            sequence: 0,
            dependencies: [],
            updatedAt: services.now(),
          };
          services.saveTask(task);
          services.store.put("invocations", request.id, request);
          services.store.enqueue("device", request.id, owner.deviceId, request);
          // Transaction commits both the task and receipt before the sender can see acceptance.
          services.respond(
            group,
            task,
            "accepted",
            imText(envelope.locale, "nativeAccepted"),
          );
        } else {
          if (
            !existing ||
            existing.groupId !== group.id ||
            existing.peer !== envelope.sender ||
            existing.workflow !== envelope.workflow
          )
            return false;
          if (envelope.action === "note") {
            // Authenticated notes belong to the timeline, never the task executor.
          } else if (envelope.action === "cancel") {
            if (existing.direction !== "incoming") return false;
            if (terminal(existing.state))
              services.respond(
                group,
                existing,
                existing.state === "cancelled"
                  ? "cancelled"
                  : existing.state === "completed"
                    ? "completed"
                    : "failed",
                existing.result ?? existing.state,
              );
            else {
              const request = services.store.get<RemoteInvocationContext>(
                "invocations",
                existing.invocationId,
              )!;
              const cancel = {
                ...request,
                id: digest(key),
                text: "",
                control: "cancel" as const,
                expiresAt: services.now() + 300000,
              };
              services.store.put("invocations", cancel.id, cancel);
              services.store.enqueue(
                "device",
                cancel.id,
                request.deviceId,
                cancel,
              );
            }
          } else {
            if (
              existing.direction !== "outgoing" ||
              envelope.replyTo !== existing.envelope.id ||
              envelope.sequence <= existing.sequence ||
              terminal(existing.state)
            )
              return false;
            const states = {
              accepted: "accepted",
              progress: "running",
              heartbeat: "running",
              completed: "completed",
              failed: "failed",
              rejected: "rejected",
              cancelled: "cancelled",
            } as const;
            if (!(envelope.action in states)) return false;
            const state = states[envelope.action as keyof typeof states];
            services.saveTask({
              ...existing,
              state:
                state === "completed" && !envelope.text.trim()
                  ? "failed"
                  : existing.state === "cancel-sent" &&
                      ["accepted", "running"].includes(state)
                    ? "cancel-sent"
                    : state,
              ...(envelope.action !== "heartbeat"
                ? { result: envelope.text }
                : {}),
              heartbeatAt: services.now(),
              sequence: envelope.sequence,
              updatedAt: services.now(),
            });
          }
        }
      }
      services.store.put("native-inbox", key, envelope);
      services.store.put(
        "native-history",
        digest(JSON.stringify([group.id, envelope.sender, envelope.id])),
        {
          version: 1,
          id: digest(JSON.stringify([group.id, envelope.sender, envelope.id])),
          groupId: group.id,
          time: services.now(),
          direction: "incoming",
          envelope,
        },
      );
      return true;
    });
  }
  const handlers = { receive };
  return handlers;
}
