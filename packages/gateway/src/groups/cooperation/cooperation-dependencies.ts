import type { Peer, NativeTask } from "./cooperation-types.js";
import type {
  CollaborationSpace,
  RemoteInvocationContext,
} from "@artemis/protocol";
import type { GatewayStore } from "../../store.js";
import type { NativeRouting } from "../../runtime/routing-contracts.js";
import type { NativeEnvelope } from "../../channels/native-protocol.js";
export interface CooperationDependencies {
  readonly store: GatewayStore;
  readonly router: NativeRouting;
  peers(groupId: string): Peer[];
  allowed(group: CollaborationSpace, peer: string): boolean;
  tasks(groupId: string): NativeTask[];
  now: () => number;
  group(id: string): CollaborationSpace;
  frame(
    group: CollaborationSpace,
    recipient: string,
    action: NativeEnvelope["action"],
    text?: string,
    task?: string,
    workflow?: string,
  ): NativeEnvelope;
  pendingProbeUntil(groupId: string, peer: string): number;
  send(
    group: CollaborationSpace,
    envelope: NativeEnvelope,
    invocationId?: string,
    permissionRejection?: boolean,
  ): void;
  address(group: CollaborationSpace): {
    platform: "feishu" | "lark" | "slack" | "wecom";
    tenant: string;
    group: string;
    sender: string;
  };
  probe(groupId: string, peer?: string): void;
  task(groupId: string, id: string): NativeTask | undefined;
  saveTask(task: NativeTask): void;
  respond(
    group: CollaborationSpace,
    task: NativeTask,
    action: NativeEnvelope["action"],
    text: string,
    cancellationReceipt?: boolean,
  ): void;
  sessionKey(
    request: RemoteInvocationContext,
    group: CollaborationSpace,
    peer: string,
  ): string;
}
