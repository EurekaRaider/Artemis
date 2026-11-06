import { type NativeEnvelope } from "../../channels/native-protocol.js";

export type Peer = {
  id: string;
  name: string;
  verifiedAt?: number;
  localizedMessages?: boolean;
};

export type NativeTask = {
  // Local persisted metadata; v1 wire compatibility uses continue/previousTask.
  sessionId?: string;
  sessionKey?: string;
  sessionReason?:
    | "continued"
    | "first-assignment"
    | "explicit-new"
    | "independent-batch"
    | "previous-rejected"
    | "sender-created";
  heartbeatAt?: number;
  version: 1;
  id: string;
  groupId: string;
  workflow: string;
  peer: string;
  direction: "incoming" | "outgoing";
  state:
    | "blocked"
    | "sent"
    | "accepted"
    | "running"
    | "completed"
    | "failed"
    | "cancel-sent"
    | "cancelled"
    | "uncertain"
    | "rejected";
  text: string;
  result?: string;
  invocationId: string;
  threadId?: string;
  cancelId?: string;
  delivery?: string;
  envelope: NativeEnvelope;
  dependencies: string[];
  sequence: number;
  updatedAt: number;
};
