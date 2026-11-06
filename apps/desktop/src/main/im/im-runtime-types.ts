import { type ImTaskTitleContext } from "../conversation/task-title.js";
import { type ImSecurityContext } from "@artemis/protocol";
import {
  type AgentEvent,
  type ApprovalResolution,
  type ImControlIntent,
  type Project,
  type RemoteInvocationContext,
  type RunMode,
  type Thread,
  type UserInputResolution,
  type PromptAttachment,
} from "@artemis/protocol";

export interface ImTaskOperations {
  locale?(): import("@artemis/protocol").AppLocale;
  classifyControlIntent?(id: string, text: string): Promise<ImControlIntent>;
  resumeDelegation?(
    id: string,
    text: string,
    mode: RunMode,
    continuationId: string,
    local: boolean,
  ): Promise<boolean>;
  groupActivity?(
    id: string,
    taskId: string,
    phase:
      | "assigned"
      | "completed"
      | "failed"
      | "input-required"
      | "approval-required",
  ): void;
  updateGroup?(id: string, title: string): void;
  importAttachments?(paths: string[]): Promise<PromptAttachment[]>;
  projects(): Project[];
  threads(): Thread[];
  thread(id: string): Thread | undefined;
  create(
    id: string,
    /** Undefined creates a project-less temporary conversation. */
    projectId: string | undefined,
    mode: RunMode,
    title: string,
  ): Promise<Thread>;
  close(id: string): Promise<void>;
  start(
    id: string,
    text: string,
    mode: RunMode,
    attachments: PromptAttachment[],
    displayText?: string,
    titleContext?: ImTaskTitleContext,
  ): Promise<void>;
  queue(
    id: string,
    text: string,
    attachments: PromptAttachment[],
    displayText?: string,
  ): Promise<void>;
  cancel(id: string): Promise<void>;
  cancelDelegationContinuation?(id: string, waitIds: string[]): Promise<void>;
  approve(resolution: ApprovalResolution): Promise<void>;
  answer(resolution: UserInputResolution): void;
  events(id: string): AgentEvent[];
  ready(): boolean;
}

export interface Binding {
  /** Persisted history remains visible but cannot be delivered under a renewed grant. */
  renewedAfterSequence?: number;
  executionStarted?: boolean;
  /** Original requester; later group messages cannot acquire task control. */
  controllerIdentity?: string;
  security?: ImSecurityContext;
  threadId: string;
  /** Absent for temporary owner chats. */
  projectId?: string;
  request: RemoteInvocationContext;
  localExecution?: boolean;
  parentThreadId?: string;
  privateLocal?: boolean;
  nativeGroup?: boolean;
  groupName?: string;
  targetDeviceIds?: string[];
}

export interface SuspendedBinding {
  binding: Binding;
  waitIds: string[];
}

export interface GroupEntry {
  threadId: string;
  projectId: string;
  created: boolean;
}

export interface Receipt {
  request: RemoteInvocationContext;
  state: "pending" | "dispatching" | "done" | "uncertain";
  threadId?: string;
}

export interface PendingAction {
  revision?: string;
  token: string;
  threadId: string;
  identity: string;
  expiresAt: number;
  payload: Extract<
    AgentEvent["payload"],
    { type: "approval.requested" | "user-input.requested" }
  >;
}
