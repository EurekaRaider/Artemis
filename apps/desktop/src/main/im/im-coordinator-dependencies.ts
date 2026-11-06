import type {
  ImTaskOperations,
  Binding,
  PendingAction,
} from "./im-runtime-types.js";
import type { ImMessageKey } from "@artemis/gateway";

import type {
  ImDelegationWaits,
  DelegationWait,
  DelegatedTaskResult,
} from "./im-delegation-waits.js";
import type { WindowsImFiles } from "./im-windows-files.js";
import type {
  ImAuthorizationCommand,
  ImAuthorizationOperation,
  ImSecurityContext,
  ImOutboundCandidate,
  ExecutionGrant,
  CollaborationSpace,
} from "@artemis/protocol";
import type { ImPermissionError } from "./im-policy.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  AgentEvent,
  ImIdentity,
  ImManagement,
  ImReply,
  ImSettings,
  ImStatus,
  Project,
  RemoteExecutionProfile,
  RemoteInvocationContext,
  RemoteOperation,
  RunMode,
} from "@artemis/protocol";
import type { SafeStorageAdapter } from "../settings/encrypted-settings-store.js";
import type { LocalImGateway } from "./im-local-gateway.js";

export interface ImCoordinatorDependencies {
  readonly db: DatabaseSync;
  decodeState<T>(raw: string): T;
  readonly secure: SafeStorageAdapter;
  get<T>(namespace: string, id: string): T | undefined;
  text(
    key: ImMessageKey,
    request?: RemoteInvocationContext,
    values?: Record<string, string | number>,
  ): string;
  usesLocalGateway(): boolean;
  config: ImSettings;
  executionRequest(binding: Binding): RemoteInvocationContext;
  pendingAudience(audience: string, except?: string): boolean;
  readonly ops: ImTaskOperations;
  securityReady: boolean;
  retiredGroup(binding: Binding): "dissolved" | "archived" | undefined;
  identities: ImIdentity[];
  put(namespace: string, id: string, value: unknown): void;
  spaces: unknown[];
  secureContext(
    binding: Binding,
    source?: ImSecurityContext["source"],
  ): ImSecurityContext;
  checkContext(binding: Binding): ExecutionGrant;
  leaseUntil: number;
  fullLocalAccess(
    binding: Binding,
    grant?: {
      projectId: string;
      policyVersion?: string | undefined;
      tokenBudget?: number | undefined;
      approval: "ask" | "automatic";
      mode: "codemode" | "plan" | "work";
      network: boolean;
      shell: boolean;
      groups: string[];
      expiresAt: number;
      security?:
        | {
            version: 2;
            revision: string;
            confirmedAt: number;
            scopes: {
              audience: string;
              revision?: string | undefined;
              contextRevision?: string | undefined;
              confirmedAt?: number | undefined;
              localAccess?: "full" | "project" | undefined;
              readMode?: "project" | "selected" | undefined;
              writeMode?: "project" | "selected" | undefined;
              spaceRevision?: string | undefined;
              filePaths?: string[] | undefined;
              readPaths: string[];
              writePaths: string[];
            }[];
          }
        | undefined;
    },
  ): boolean;
  get scopedExecutionSupported(): boolean;
  grant(binding: Binding): {
    projectId: string;
    policyVersion?: string | undefined;
    tokenBudget?: number | undefined;
    approval: "ask" | "automatic";
    mode: "codemode" | "plan" | "work";
    network: boolean;
    shell: boolean;
    groups: string[];
    expiresAt: number;
    security?:
      | {
          version: 2;
          revision: string;
          confirmedAt: number;
          scopes: {
            audience: string;
            revision?: string | undefined;
            contextRevision?: string | undefined;
            confirmedAt?: number | undefined;
            localAccess?: "full" | "project" | undefined;
            readMode?: "project" | "selected" | undefined;
            writeMode?: "project" | "selected" | undefined;
            spaceRevision?: string | undefined;
            filePaths?: string[] | undefined;
            readPaths: string[];
            writePaths: string[];
          }[];
        }
      | undefined;
  };
  authorizeThread(threadId: string, mode: RunMode): void;
  authorizeOperation(
    threadId: string,
    operation: RemoteOperation,
    mode: RunMode,
    turnId?: string,
  ): {
    projectId: string;
    policyVersion?: string | undefined;
    tokenBudget?: number | undefined;
    approval: "ask" | "automatic";
    mode: "codemode" | "plan" | "work";
    network: boolean;
    shell: boolean;
    groups: string[];
    expiresAt: number;
    security?:
      | {
          version: 2;
          revision: string;
          confirmedAt: number;
          scopes: {
            audience: string;
            revision?: string | undefined;
            contextRevision?: string | undefined;
            confirmedAt?: number | undefined;
            localAccess?: "full" | "project" | undefined;
            readMode?: "project" | "selected" | undefined;
            writeMode?: "project" | "selected" | undefined;
            spaceRevision?: string | undefined;
            filePaths?: string[] | undefined;
            readPaths: string[];
            writePaths: string[];
          }[];
        }
      | undefined;
  };
  groupContext(binding: Binding): {
    retired?: "archived" | "dissolved" | undefined;
    roster?:
      | {
          members: {
            identity: {
              channel: "feishu" | "slack" | "wecom";
              connectionId: string;
              tenantId: string;
              appId: string;
              userId: string;
            };
            name: string;
            kind: "bot" | "human" | "unknown";
            self?: boolean | undefined;
            presence?: "active" | "away" | "unknown" | undefined;
            presenceCheckedAt?: number | undefined;
            presenceError?:
              "missing-scope" | "rate-limited" | "unavailable" | undefined;
            botPresence?:
              | {
                  state:
                    | "busy"
                    | "offline"
                    | "online"
                    | "unknown"
                    | "waiting-approval";
                  source: "local" | "peer" | "task";
                  checkedAt: number;
                  expiresAt: number;
                }
              | undefined;
            canAssign?: boolean | undefined;
            verifiedAt?: number | undefined;
            verificationPendingUntil?: number | undefined;
            owner?: boolean | undefined;
          }[];
          complete: boolean;
          error?:
            | "missing-scope"
            | "partial"
            | "rate-limited"
            | "unavailable"
            | undefined;
        }
      | undefined;
    native?: boolean | undefined;
    capability?: "events" | "manual" | undefined;
    spaceId: string;
    name: string;
    confirmed: boolean;
    executingDeviceId: string;
    stale: boolean;
    targetDeviceIds?: string[] | undefined;
    members: {
      deviceId: string;
      identity: {
        channel: "feishu" | "slack" | "wecom";
        connectionId: string;
        tenantId: string;
        appId: string;
        userId: string;
      };
      name: string;
      deviceName: string;
      state: "offline" | "online" | "unavailable" | "unknown";
    }[];
  };
  remove(namespace: string, id: string): void;
  serializeAuthorization<T>(work: () => Promise<T>): Promise<T>;
  pendingAuthorizations(): ImAuthorizationOperation[];
  savePreparedSettings(
    settings: ImSettings,
    operation?: ImAuthorizationOperation,
  ): Promise<ImStatus>;
  prepareSettings(input: unknown): Promise<ImSettings>;
  token: string;
  checkSandbox(workspace: string): Promise<void>;
  http(
    path: string,
    method?: string,
    body?: unknown,
    credential?: {
      url: string;
      token: string;
    },
  ): Promise<Response>;
  applySettingsEffects(settings: ImSettings): Promise<ImStatus>;
  list<T>(namespace: string): T[];
  cancelOperations(threadId: string): void;
  syncSecurity(completingOperation?: string): Promise<void>;
  error: string | undefined;
  state: ImStatus["state"];
  status(): ImStatus & {
    connections: unknown[];
    spaces: unknown[];
    remoteTasks: NonNullable<ImStatus["remoteTasks"]>;
  };
  authorizationTail: Promise<unknown>;
  ensureLocalGateway(): Promise<{
    url: string;
    token: string;
  }>;
  authorizationSnapshot(command: ImAuthorizationCommand): Promise<{
    credential: {
      url: string;
      token: string;
    };
    group: CollaborationSpace | undefined;
  }>;
  checkAuthorizationVersions(
    command: ImAuthorizationCommand,
    group?: CollaborationSpace,
    operation?: ImAuthorizationOperation,
  ): void;
  authorizationSettings(
    command: ImAuthorizationCommand,
    group: CollaborationSpace,
  ): ImSettings;
  completingAuthorization: string | undefined;
  refreshConnection(): Promise<void>;
  syncGroupConversations(): Promise<void>;
  securitySyncTail: Promise<unknown>;
  sendSecurity(completingOperation?: string): Promise<void>;
  closed: boolean;
  readonly localGateway: LocalImGateway;
  manage(input: ImManagement, serialized?: boolean): Promise<unknown>;
  readonly sessionId: `${string}-${string}-${string}-${string}-${string}`;
  localActivity(): "online" | "busy" | "waiting-approval";
  polling: boolean;
  reconciled: boolean;
  observe(events: readonly AgentEvent[]): void;
  drain(): Promise<void>;
  drainDelegationWaits(): Promise<void>;
  resolveOutbound(
    id: string,
    hash: string,
    approve: boolean,
    text?: string,
  ): Promise<void>;
  deliverApproved(candidate: ImOutboundCandidate): Promise<void>;
  applyRetiredGroups(raw: unknown): Promise<void>;
  pairingRequests: NonNullable<ImStatus["pairingRequests"]>;
  removedConnections: Set<string>;
  channelStatus: unknown[];
  displaySpaces(): (
    | {
        id: string;
        name: string;
        endpoints?:
          | {
              [x: string]: unknown;
              connectionId: string;
            }[]
          | undefined;
        nativeGroup?:
          | {
              [x: string]: unknown;
              ownerDeviceId: string;
            }
          | undefined;
        roster?:
          | {
              members: {
                identity: {
                  channel: "feishu" | "slack" | "wecom";
                  connectionId: string;
                  tenantId: string;
                  appId: string;
                  userId: string;
                };
                name: string;
                kind: "bot" | "human" | "unknown";
                self?: boolean | undefined;
                presence?: "active" | "away" | "unknown" | undefined;
                presenceCheckedAt?: number | undefined;
                presenceError?:
                  "missing-scope" | "rate-limited" | "unavailable" | undefined;
                botPresence?:
                  | {
                      state:
                        | "busy"
                        | "offline"
                        | "online"
                        | "unknown"
                        | "waiting-approval";
                      source: "local" | "peer" | "task";
                      checkedAt: number;
                      expiresAt: number;
                    }
                  | undefined;
                canAssign?: boolean | undefined;
                verifiedAt?: number | undefined;
                verificationPendingUntil?: number | undefined;
                owner?: boolean | undefined;
              }[];
              complete: boolean;
              error?:
                | "missing-scope"
                | "partial"
                | "rate-limited"
                | "unavailable"
                | undefined;
            }
          | undefined;
        participants: {
          deviceId: string;
          identity: {
            channel: "feishu" | "slack" | "wecom";
            connectionId: string;
            tenantId: string;
            appId: string;
            userId: string;
          };
          state: "offline" | "online" | "unavailable" | "unknown";
          name: string;
          deviceName: string;
        }[];
      }
    | {
        id: string;
        name: string;
        endpoints?:
          | {
              [x: string]: unknown;
              connectionId: string;
            }[]
          | undefined;
        nativeGroup?:
          | {
              [x: string]: unknown;
              ownerDeviceId: string;
            }
          | undefined;
        roster: {
          complete: boolean;
          error?:
            | "missing-scope"
            | "partial"
            | "rate-limited"
            | "unavailable"
            | undefined;
          members: {
            identity: {
              channel: "feishu" | "slack" | "wecom";
              connectionId: string;
              tenantId: string;
              appId: string;
              userId: string;
            };
            name: string;
            kind: "bot" | "human" | "unknown";
            self?: boolean | undefined;
            presence?: "active" | "away" | "unknown" | undefined;
            presenceCheckedAt?: number | undefined;
            presenceError?:
              "missing-scope" | "rate-limited" | "unavailable" | undefined;
            botPresence?:
              | {
                  state:
                    | "busy"
                    | "offline"
                    | "online"
                    | "unknown"
                    | "waiting-approval";
                  source: "local" | "peer" | "task";
                  checkedAt: number;
                  expiresAt: number;
                }
              | {
                  state: string;
                  source: "local";
                  checkedAt: number;
                  expiresAt: number;
                }
              | undefined;
            canAssign?: boolean | undefined;
            verifiedAt?: number | undefined;
            verificationPendingUntil?: number | undefined;
            owner?: boolean | undefined;
          }[];
        };
        participants: {
          deviceId: string;
          identity: {
            channel: "feishu" | "slack" | "wecom";
            connectionId: string;
            tenantId: string;
            appId: string;
            userId: string;
          };
          state: "offline" | "online" | "unavailable" | "unknown";
          name: string;
          deviceName: string;
        }[];
      }
  )[];
  syncingGroups: Promise<void> | undefined;
  groupConversationError: string | undefined;
  groupEntryKey(spaceId: string): string;
  hasPermissionBlock(threadId: string): boolean;
  readonly delegationWaits: ImDelegationWaits;
  interruptionReason(wait: DelegationWait): string;
  threadConnectionState(
    binding: Binding,
  ): NonNullable<
    NonNullable<ImStatus["remoteTasks"]>[number]["connectionState"]
  >;
  readonly retiredThreads: Set<string>;
  refreshNativeHistory(threadId: string, groupId: string): Promise<void>;
  starts: Map<
    string,
    {
      projectId: string | undefined;
      remote: boolean;
      mode: RunMode;
    }
  >;
  availableProjects(request: RemoteInvocationContext): Project[];
  renewGroupTurn(binding: Binding): Promise<Binding>;
  delegationSecurity(binding: Binding): string;
  cancelDelegationTask(
    threadId: string,
    taskId: string,
    stopTurn?: boolean,
  ): Promise<void>;
  profile(threadId: string): RemoteExecutionProfile | undefined;
  readonly activeProjectWrites: Set<string>;
  readonly projectWrites: Map<string, Promise<void>>;
  controllers: Map<string, Set<AbortController>>;
  clearReplyStream(threadId: string): void;
  operateScoped(
    threadId: string,
    operationInput: RemoteOperation,
    mode: RunMode,
    callId: string,
    turnId?: string,
  ): Promise<unknown>;
  withProjectWrite<T>(
    threadId: string,
    operation: RemoteOperation,
    mode: RunMode,
    turnId: string | undefined,
    run: () => Promise<T>,
  ): Promise<T>;
  blockPermission(
    threadId: string,
    denied: ImPermissionError,
    turnId?: string,
  ): {
    state: string;
    parkPermission: boolean;
    code: "scope-denied" | "system-denied";
    allowedScope?: {
      audience: string;
      revision?: string | undefined;
      contextRevision?: string | undefined;
      confirmedAt?: number | undefined;
      localAccess?: "full" | "project" | undefined;
      readMode?: "project" | "selected" | undefined;
      writeMode?: "project" | "selected" | undefined;
      spaceRevision?: string | undefined;
      filePaths?: string[] | undefined;
      readPaths: string[];
      writePaths: string[];
    };
    message: string;
  };
  validatedSandboxes: Set<string>;
  readonly windowsHelper: string | undefined | undefined;
  waitForDelegation(
    binding: Binding,
    command: Extract<
      RemoteOperation,
      {
        action: "collaborate";
      }
    >["command"],
    callId: string,
    turnId?: string,
  ): Promise<unknown>;
  suspendedWait(id: string, threadId: string): boolean;
  interruptFailedWait(
    wait: DelegationWait,
    stopTurn: boolean,
    turnId?: string,
  ): Promise<boolean>;
  observedDelegation(task: DelegatedTaskResult): {
    id: string;
    threadId?: string;
    invocationId?: string;
    direction: string;
    envelope: {
      id: string;
      issuedAt?: number;
    };
    result?: string;
    text?: string;
    heartbeatAt?: number;
    reportedState: string;
    state: string;
    liveness: string;
    localWait: {
      active: boolean;
      state: string;
      waitId?: string;
    };
    instruction: string;
  };
  hasDelegationWait(threadId: string): boolean;
  deliverySecurity(
    context: ImSecurityContext,
  ): NonNullable<ImReply["security"]>;
  readonly windowsFiles: WindowsImFiles | undefined;
  observeEvent(event: AgentEvent): void;
  observeGroupActivity(event: AgentEvent): void;
  reply(
    request: RemoteInvocationContext,
    text: string,
    taskId?: string,
    final?: boolean,
    visibility?: ImReply["visibility"],
    id?: string,
    outcome?: ImReply["outcome"],
    started?: boolean,
    status?: ImReply["status"],
    approval?: ImReply["approval"],
    stream?: boolean,
  ): void;
  replyApprovalResult(
    binding: Binding,
    action: PendingAction,
    approved: boolean,
    id: string,
  ): void;
  observeReplyStream(
    binding: Binding,
    threadId: string,
    turnId: string,
    delta: string,
  ): void;
  finalText(threadId: string, turnId?: string, partId?: string): string;
  restoreBinding(threadId: string): void;
}
