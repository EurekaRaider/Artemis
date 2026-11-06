import {
  type ImTaskOperations,
  type Binding,
  type PendingAction,
} from "./im-runtime-types.js";
import { type ImMessageKey } from "@artemis/gateway";
import { SlackSetupService } from "./slack-setup-service.js";
import type { SlackCliRuntime } from "./slack-cli-runner.js";
import {
  ImDelegationWaits,
  type DelegatedTaskResult,
} from "./im-delegation-waits.js";
import { WindowsImFiles } from "./im-windows-files.js";
import {
  type ImAuthorizationCommand,
  type ImAuthorizationOperation,
  type ImSecurityContext,
  type ImOutboundCandidate,
  type ExecutionGrant,
} from "@artemis/protocol";

import { DatabaseSync } from "node:sqlite";
import {
  type ImIdentity,
  type ImManagement,
  type ImReply,
  type ImSettings,
  type ImStatus,
  type RemoteInvocationContext,
  type RunMode,
  type Thread,
} from "@artemis/protocol";
import type { SafeStorageAdapter } from "../settings/encrypted-settings-store.js";
import { LocalImGateway } from "./im-local-gateway.js";
import { readLegacyImSettings } from "./im-legacy-import.js";
export interface ImServiceDependencies {
  readonly delegationWaits: ImDelegationWaits;
  get<T>(namespace: string, id: string): T | undefined;
  readonly ops: ImTaskOperations;
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
  put(namespace: string, id: string, value: unknown): void;
  remove(namespace: string, id: string): void;
  list<T>(namespace: string): T[];
  manage(input: ImManagement, serialized?: boolean): Promise<unknown>;
  text(
    key: ImMessageKey,
    request?: RemoteInvocationContext,
    values?: Record<string, string | number>,
  ): string;
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
  readonly shortWaits: Set<string>;
  starts: Map<
    string,
    {
      projectId: string | undefined;
      remote: boolean;
      mode: RunMode;
    }
  >;
  checkContext(binding: Binding): ExecutionGrant;
  http(
    path: string,
    method?: string,
    body?: unknown,
    credential?: {
      url: string;
      token: string;
    },
  ): Promise<Response>;
  closed: boolean;
  readonly secure: SafeStorageAdapter;
  deliverySecurity(
    context: ImSecurityContext,
  ): NonNullable<ImReply["security"]>;
  readonly db: DatabaseSync;
  config: ImSettings;
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
  readonly replyStreams: Map<
    string,
    {
      text: string;
      turnId: string;
      lastAt: number;
      timer?: ReturnType<typeof setTimeout> | undefined;
    }
  >;
  usesLocalGateway(): boolean;
  readonly slackRuntime?: SlackCliRuntime | undefined;
  slackSetup: SlackSetupService | undefined;
  readonly directory: string;
  refreshConnection(): Promise<void>;
  channelStatus: unknown[];
  serializeAuthorization<T>(work: () => Promise<T>): Promise<T>;
  pendingAuthorizations(): ImAuthorizationOperation[];
  submitGroupAuthorization(
    raw: ImAuthorizationCommand,
  ): Promise<ImAuthorizationOperation>;
  cancelDelegationTask(
    threadId: string,
    taskId: string,
    stopTurn?: boolean,
  ): Promise<void>;
  resolveOutbound(
    id: string,
    hash: string,
    approve: boolean,
    text?: string,
  ): Promise<void>;
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
  status(): ImStatus & {
    connections: unknown[];
    spaces: unknown[];
    remoteTasks: NonNullable<ImStatus["remoteTasks"]>;
  };
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
  readonly legacyImports: Map<
    string,
    {
      expiresAt: number;
      gatewayUrl: string;
      config: ReturnType<typeof readLegacyImSettings>[number];
    }
  >;
  localSetup: Promise<unknown> | undefined;
  setupLocalGateway(): Promise<ImStatus>;
  token: string;
  readonly localGateway: LocalImGateway;
  identities: ImIdentity[];
  pairingRequests: NonNullable<ImStatus["pairingRequests"]>;
  removedConnections: Set<string>;
  spaces: unknown[];
  ensureLocalGateway(): Promise<{
    url: string;
    token: string;
  }>;
  savePreparedSettings(
    settings: ImSettings,
    operation?: ImAuthorizationOperation,
  ): Promise<ImStatus>;
  prepareSettings(input: unknown): Promise<ImSettings>;
  state: ImStatus["state"];
  taskState(
    thread: Thread,
    request?:
      | {
          locale?:
            | "ar"
            | "de"
            | "en"
            | "es"
            | "fr"
            | "hi"
            | "id"
            | "it"
            | "ja"
            | "ko"
            | "pt-BR"
            | "ru"
            | "zh-CN"
            | "zh-TW"
            | undefined;
          nativeTaskId?: string | undefined;
          nativeNewSession?: true | undefined;
          sourceKind?: "direct" | "member" | "tool-result" | undefined;
          version: 1;
          id: string;
          deviceId: string;
          identity: {
            channel: "feishu" | "slack" | "wecom";
            connectionId: string;
            tenantId: string;
            appId: string;
            userId: string;
          };
          conversation: {
            connectionId: string;
            id: string;
            kind: "direct" | "group";
            spaceId?: string | undefined;
            spaceRevision?: string | undefined;
          };
          messageId: string;
          text: string;
          taskId?: string | undefined;
          originator?:
            | {
                channel: "feishu" | "slack" | "wecom";
                connectionId: string;
                tenantId: string;
                appId: string;
                userId: string;
              }
            | undefined;
          desktopTurnId?: string | undefined;
          control?: "cancel" | undefined;
          expiresAt: number;
          attachments: {
            name: string;
            kind: "file" | "image";
            resourceId: string;
            url?: string | undefined;
            decryptionKey?: string | undefined;
          }[];
          collaboration?:
            | {
                taskId: string;
                coordinatorDeviceId: string;
                coordinatorThreadId: string;
                mission: string;
              }
            | undefined;
        }
      | undefined,
  ): string;
  finalText(threadId: string, turnId?: string, partId?: string): string;
  cancelOperations(threadId: string): void;
  restoreBinding(threadId: string): void;
  hasPermissionBlock(threadId: string): boolean;
  hasDelegationWait(threadId: string): boolean;
  groupEntryKey(spaceId: string): string;
  cancelThreadDelegations(
    threadId: string,
    currentAssignmentOnly?: boolean,
  ): Promise<boolean>;
  replyApprovalResult(
    binding: Binding,
    action: PendingAction,
    approved: boolean,
    id: string,
  ): void;
  readonly windowsFiles: WindowsImFiles | undefined;
  holdOutbound(
    binding: Binding,
    kind: ImOutboundCandidate["kind"],
    body: unknown,
    reason: string,
    id?: string,
  ): ImOutboundCandidate;
  recordNativeFile(binding: Binding, invocationId: string, name: string): void;
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
  hasBinding(threadId: string): boolean;
  secureContext(
    binding: Binding,
    source?: ImSecurityContext["source"],
  ): ImSecurityContext;
  deleteThread(threadId: string): void;
  suspendedWait(id: string, threadId: string): boolean;
}
