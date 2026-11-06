import { LOCALE_CAPABILITY } from "./cooperation-values.js";
import type { NativeTask } from "./cooperation-types.js";
import { imText } from "../../i18n/im-localization.js";

import { randomUUID } from "node:crypto";
import type { CollaborationSpace } from "@artemis/protocol";
import { digest } from "../../store.js";
import type { Delivery } from "../../runtime/routing-contracts.js";

import {
  encodeNativeEnvelope,
  type NativeEnvelope,
} from "../../channels/native-protocol.js";
import type { CooperationDependencies } from "./cooperation-dependencies.js";
export function createCooperationTransport(
  services: Pick<
    CooperationDependencies,
    | "router"
    | "address"
    | "now"
    | "peers"
    | "store"
    | "task"
    | "frame"
    | "saveTask"
    | "send"
  >,
) {
  function frame(
    group: CollaborationSpace,
    recipient: string,
    action: NativeEnvelope["action"],
    text = "",
    task: string = randomUUID(),
    workflow: string = randomUUID(),
  ): NativeEnvelope {
    return {
      version: 1,
      locale: services.router.deviceLocale(group.nativeGroup!.ownerDeviceId),
      id: randomUUID(),
      ...services.address(group),
      recipient,
      action,
      text: ["hello", "probe", "proof"].includes(action)
        ? LOCALE_CAPABILITY
        : text,
      task,
      workflow,
      issuedAt: services.now(),
      expiresAt: services.now() + 30 * 60000,
      sequence: 0,
    };
  }

  function send(
    group: CollaborationSpace,
    envelope: NativeEnvelope,
    invocationId?: string,
    permissionRejection = false,
  ): void {
    // Older v1 peers reject unknown envelope fields. Advertise support in the
    // existing handshake text and add locale only after a correlated proof.
    const wire = { ...envelope };
    if (
      ["hello", "probe", "proof"].includes(envelope.action) ||
      !services.peers(group.id).find((peer) => peer.id === envelope.recipient)
        ?.localizedMessages
    )
      delete wire.locale;
    const delivery: Delivery = {
      conversation: {
        ...group.endpoints[0]!,
        spaceId: group.id,
        spaceRevision: group.revision,
      },
      text: encodeNativeEnvelope(wire),
      native: envelope,
      ...(invocationId ? { invocationId } : {}),
    };
    if (permissionRejection)
      services.store.put("native-permission-rejections", envelope.id, delivery);
    services.store.enqueue(
      "outgoing",
      `native:${envelope.id}`,
      delivery.conversation.connectionId,
      delivery,
    );
    if (["presence-query", "presence"].includes(envelope.action)) return;
    services.store.put(
      "native-history",
      digest(JSON.stringify([group.id, envelope.sender, envelope.id])),
      {
        version: 1,
        id: digest(JSON.stringify([group.id, envelope.sender, envelope.id])),
        groupId: group.id,
        time: services.now(),
        direction: "outgoing",
        envelope,
      },
    );
  }

  function respond(
    group: CollaborationSpace,
    task: NativeTask,
    action: NativeEnvelope["action"],
    text: string,
    cancellationReceipt = false,
  ) {
    const current = services.task(task.groupId, task.id)!;
    const envelope = services.frame(
      group,
      task.peer,
      action,
      cancellationReceipt
        ? imText(task.envelope.locale, "taskCancelled")
        : Buffer.from(text).subarray(0, 12000).toString("utf8").slice(0, 8000),
      task.id,
      task.workflow,
    );
    envelope.replyTo = task.envelope.id;
    if (task.envelope.locale) envelope.locale = task.envelope.locale;
    envelope.sequence = current.sequence + 1;
    services.saveTask({
      ...current,
      sequence: envelope.sequence,
    });
    services.send(
      group,
      envelope,
      cancellationReceipt ? undefined : task.invocationId,
    );
  }
  const handlers = { frame, send, respond };
  return handlers;
}
