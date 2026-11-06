import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
import { createImEventObserver } from "./im-event-observer.js";
import { createImScopedOperations } from "./im-scoped-operations.js";
import { createImLocalExecution } from "./im-local-execution.js";
import { createImGroupSynchronization } from "./im-group-synchronization.js";
import { createImGroupPresentation } from "./im-group-presentation.js";
import { createImConnectionCoordinator } from "./im-connection-coordinator.js";
import { createImAuthorizationCoordinator } from "./im-authorization-coordinator.js";
import { createImConfiguration } from "./im-configuration.js";
import { createImSecurityContext } from "./im-security-context.js";
import { createImStateRepository } from "./im-state-repository.js";
import type { ImServiceDependencies } from "./im-service-dependencies.js";
import { createImCommandRuntime } from "./im-command-runtime.js";
import { createImManagementRuntime } from "./im-management-runtime.js";
import { createImOutboundRuntime } from "./im-outbound-runtime.js";
import { createImDelegationRuntime } from "./im-delegation-runtime.js";
import { errorMessage } from "./im-runtime-values.js";
import type {
  ImTaskOperations,
  Binding,
  Receipt,
  PendingAction,
} from "./im-runtime-types.js";

import { imText, type ImMessageKey } from "@artemis/gateway";

import { SlackSetupService } from "./slack-setup-service.js";
import type { SlackCliRuntime } from "./slack-cli-runner.js";
import {
  ImDelegationWaits,
  type DelegationWait,
  type DelegatedTaskResult,
} from "./im-delegation-waits.js";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

import { WindowsImFiles } from "./im-windows-files.js";
import {
  type ImAuthorizationCommand,
  type ImAuthorizationOperation,
  IM_SECURITY_VERSION,
  type ImSecurityContext,
  type ImOutboundCandidate,
  type ExecutionGrant,
  type CollaborationSpace,
} from "@artemis/protocol";
import { ImPermissionError } from "./im-policy.js";
import { DatabaseSync } from "node:sqlite";

import { join } from "node:path";

import {
  imSettingsSchema,
  type AgentEvent,
  type ImIdentity,
  type ImManagement,
  type ImReply,
  type ImSettings,
  type ImStatus,
  type Project,
  type RemoteExecutionProfile,
  type RemoteInvocationContext,
  type RemoteOperation,
  type RunMode,
  type Thread,
  type PromptAttachment,
} from "@artemis/protocol";
import type { SafeStorageAdapter } from "../settings/encrypted-settings-store.js";
import { LocalImGateway } from "./im-local-gateway.js";
import { readLegacyImSettings } from "./im-legacy-import.js";

/** The desktop owns grants and task invocation; Gateway data never carries local paths or tool credentials. */
export class ImService {
  private readonly imStateRepository = createImStateRepository(
    this.coordinatorDependencies(),
  );
  private readonly imSecurityContext = createImSecurityContext(
    this.coordinatorDependencies(),
  );
  private readonly imConfiguration = createImConfiguration(
    this.coordinatorDependencies(),
  );
  private readonly imAuthorizationCoordinator =
    createImAuthorizationCoordinator(this.coordinatorDependencies());
  private readonly imConnectionCoordinator = createImConnectionCoordinator(
    this.coordinatorDependencies(),
  );
  private readonly imGroupPresentation = createImGroupPresentation(
    this.coordinatorDependencies(),
  );
  private readonly imGroupSynchronization = createImGroupSynchronization(
    this.coordinatorDependencies(),
  );
  private readonly imLocalExecution = createImLocalExecution(
    this.coordinatorDependencies(),
  );
  private readonly imScopedOperations = createImScopedOperations(
    this.coordinatorDependencies(),
  );
  private readonly imEventObserver = createImEventObserver(
    this.coordinatorDependencies(),
  );
  private coordinatorDependencies(): ImCoordinatorDependencies {
    const host = this;
    return {
      get db() {
        return host.db;
      },
      get decodeState() {
        return host.decodeState.bind(host);
      },
      get secure() {
        return host.secure;
      },
      get get() {
        return host.get.bind(host);
      },
      get text() {
        return host.text.bind(host);
      },
      get usesLocalGateway() {
        return host.usesLocalGateway.bind(host);
      },
      get config() {
        return host.config;
      },
      set config(value: ImCoordinatorDependencies["config"]) {
        host.config = value;
      },
      get executionRequest() {
        return host.executionRequest.bind(host);
      },
      get pendingAudience() {
        return host.pendingAudience.bind(host);
      },
      get ops() {
        return host.ops;
      },
      get securityReady() {
        return host.securityReady;
      },
      set securityReady(value: ImCoordinatorDependencies["securityReady"]) {
        host.securityReady = value;
      },
      get retiredGroup() {
        return host.retiredGroup.bind(host);
      },
      get identities() {
        return host.identities;
      },
      set identities(value: ImCoordinatorDependencies["identities"]) {
        host.identities = value;
      },
      get put() {
        return host.put.bind(host);
      },
      get spaces() {
        return host.spaces;
      },
      set spaces(value: ImCoordinatorDependencies["spaces"]) {
        host.spaces = value;
      },
      get secureContext() {
        return host.secureContext.bind(host);
      },
      get checkContext() {
        return host.checkContext.bind(host);
      },
      get leaseUntil() {
        return host.leaseUntil;
      },
      set leaseUntil(value: ImCoordinatorDependencies["leaseUntil"]) {
        host.leaseUntil = value;
      },
      get fullLocalAccess() {
        return host.fullLocalAccess.bind(host);
      },
      get scopedExecutionSupported() {
        return host.scopedExecutionSupported;
      },
      get grant() {
        return host.grant.bind(host);
      },
      get authorizeThread() {
        return host.authorizeThread.bind(host);
      },
      get authorizeOperation() {
        return host.authorizeOperation.bind(host);
      },
      get groupContext() {
        return host.groupContext.bind(host);
      },
      get remove() {
        return host.remove.bind(host);
      },
      get serializeAuthorization() {
        return host.serializeAuthorization.bind(host);
      },
      get pendingAuthorizations() {
        return host.pendingAuthorizations.bind(host);
      },
      get savePreparedSettings() {
        return host.savePreparedSettings.bind(host);
      },
      get prepareSettings() {
        return host.prepareSettings.bind(host);
      },
      get token() {
        return host.token;
      },
      set token(value: ImCoordinatorDependencies["token"]) {
        host.token = value;
      },
      get checkSandbox() {
        return host.checkSandbox.bind(host);
      },
      get http() {
        return host.http.bind(host);
      },
      get applySettingsEffects() {
        return host.applySettingsEffects.bind(host);
      },
      get list() {
        return host.list.bind(host);
      },
      get cancelOperations() {
        return host.cancelOperations.bind(host);
      },
      get syncSecurity() {
        return host.syncSecurity.bind(host);
      },
      get error() {
        return host.error;
      },
      set error(value: ImCoordinatorDependencies["error"]) {
        host.error = value;
      },
      get state() {
        return host.state;
      },
      set state(value: ImCoordinatorDependencies["state"]) {
        host.state = value;
      },
      get status() {
        return host.status.bind(host);
      },
      get authorizationTail() {
        return host.authorizationTail;
      },
      set authorizationTail(
        value: ImCoordinatorDependencies["authorizationTail"],
      ) {
        host.authorizationTail = value;
      },
      get ensureLocalGateway() {
        return host.ensureLocalGateway.bind(host);
      },
      get authorizationSnapshot() {
        return host.authorizationSnapshot.bind(host);
      },
      get checkAuthorizationVersions() {
        return host.checkAuthorizationVersions.bind(host);
      },
      get authorizationSettings() {
        return host.authorizationSettings.bind(host);
      },
      get completingAuthorization() {
        return host.completingAuthorization;
      },
      set completingAuthorization(
        value: ImCoordinatorDependencies["completingAuthorization"],
      ) {
        host.completingAuthorization = value;
      },
      get refreshConnection() {
        return host.refreshConnection.bind(host);
      },
      get syncGroupConversations() {
        return host.syncGroupConversations.bind(host);
      },
      get securitySyncTail() {
        return host.securitySyncTail;
      },
      set securitySyncTail(
        value: ImCoordinatorDependencies["securitySyncTail"],
      ) {
        host.securitySyncTail = value;
      },
      get sendSecurity() {
        return host.sendSecurity.bind(host);
      },
      get closed() {
        return host.closed;
      },
      set closed(value: ImCoordinatorDependencies["closed"]) {
        host.closed = value;
      },
      get localGateway() {
        return host.localGateway;
      },
      get manage() {
        return host.manage.bind(host);
      },
      get sessionId() {
        return host.sessionId;
      },
      get localActivity() {
        return host.localActivity.bind(host);
      },
      get polling() {
        return host.polling;
      },
      set polling(value: ImCoordinatorDependencies["polling"]) {
        host.polling = value;
      },
      get reconciled() {
        return host.reconciled;
      },
      set reconciled(value: ImCoordinatorDependencies["reconciled"]) {
        host.reconciled = value;
      },
      get observe() {
        return host.observe.bind(host);
      },
      get drain() {
        return host.drain.bind(host);
      },
      get drainDelegationWaits() {
        return host.drainDelegationWaits.bind(host);
      },
      get resolveOutbound() {
        return host.resolveOutbound.bind(host);
      },
      get deliverApproved() {
        return host.deliverApproved.bind(host);
      },
      get applyRetiredGroups() {
        return host.applyRetiredGroups.bind(host);
      },
      get pairingRequests() {
        return host.pairingRequests;
      },
      set pairingRequests(value: ImCoordinatorDependencies["pairingRequests"]) {
        host.pairingRequests = value;
      },
      get removedConnections() {
        return host.removedConnections;
      },
      set removedConnections(
        value: ImCoordinatorDependencies["removedConnections"],
      ) {
        host.removedConnections = value;
      },
      get channelStatus() {
        return host.channelStatus;
      },
      set channelStatus(value: ImCoordinatorDependencies["channelStatus"]) {
        host.channelStatus = value;
      },
      get displaySpaces() {
        return host.displaySpaces.bind(host);
      },
      get syncingGroups() {
        return host.syncingGroups;
      },
      set syncingGroups(value: ImCoordinatorDependencies["syncingGroups"]) {
        host.syncingGroups = value;
      },
      get groupConversationError() {
        return host.groupConversationError;
      },
      set groupConversationError(
        value: ImCoordinatorDependencies["groupConversationError"],
      ) {
        host.groupConversationError = value;
      },
      get groupEntryKey() {
        return host.groupEntryKey.bind(host);
      },
      get hasPermissionBlock() {
        return host.hasPermissionBlock.bind(host);
      },
      get delegationWaits() {
        return host.delegationWaits;
      },
      get interruptionReason() {
        return host.interruptionReason.bind(host);
      },
      get threadConnectionState() {
        return host.threadConnectionState.bind(host);
      },
      get retiredThreads() {
        return host.retiredThreads;
      },
      get refreshNativeHistory() {
        return host.refreshNativeHistory.bind(host);
      },
      get starts() {
        return host.starts;
      },
      set starts(value: ImCoordinatorDependencies["starts"]) {
        host.starts = value;
      },
      get availableProjects() {
        return host.availableProjects.bind(host);
      },
      get renewGroupTurn() {
        return host.renewGroupTurn.bind(host);
      },
      get delegationSecurity() {
        return host.delegationSecurity.bind(host);
      },
      get cancelDelegationTask() {
        return host.cancelDelegationTask.bind(host);
      },
      get profile() {
        return host.profile.bind(host);
      },
      get activeProjectWrites() {
        return host.activeProjectWrites;
      },
      get projectWrites() {
        return host.projectWrites;
      },
      get controllers() {
        return host.controllers;
      },
      set controllers(value: ImCoordinatorDependencies["controllers"]) {
        host.controllers = value;
      },
      get clearReplyStream() {
        return host.clearReplyStream.bind(host);
      },
      get operateScoped() {
        return host.operateScoped.bind(host);
      },
      get withProjectWrite() {
        return host.withProjectWrite.bind(host);
      },
      get blockPermission() {
        return host.blockPermission.bind(host);
      },
      get validatedSandboxes() {
        return host.validatedSandboxes;
      },
      set validatedSandboxes(
        value: ImCoordinatorDependencies["validatedSandboxes"],
      ) {
        host.validatedSandboxes = value;
      },
      get windowsHelper() {
        return host.windowsHelper;
      },
      get waitForDelegation() {
        return host.waitForDelegation.bind(host);
      },
      get suspendedWait() {
        return host.suspendedWait.bind(host);
      },
      get interruptFailedWait() {
        return host.interruptFailedWait.bind(host);
      },
      get observedDelegation() {
        return host.observedDelegation.bind(host);
      },
      get hasDelegationWait() {
        return host.hasDelegationWait.bind(host);
      },
      get deliverySecurity() {
        return host.deliverySecurity.bind(host);
      },
      get windowsFiles() {
        return host.windowsFiles;
      },
      get observeEvent() {
        return host.observeEvent.bind(host);
      },
      get observeGroupActivity() {
        return host.observeGroupActivity.bind(host);
      },
      get reply() {
        return host.reply.bind(host);
      },
      get replyApprovalResult() {
        return host.replyApprovalResult.bind(host);
      },
      get observeReplyStream() {
        return host.observeReplyStream.bind(host);
      },
      get finalText() {
        return host.finalText.bind(host);
      },
      get restoreBinding() {
        return host.restoreBinding.bind(host);
      },
    };
  }

  private readonly imDelegationRuntime = createImDelegationRuntime(
    this.runtimeDependencies(),
  );
  private readonly imOutboundRuntime = createImOutboundRuntime(
    this.runtimeDependencies(),
  );
  private readonly imManagementRuntime = createImManagementRuntime(
    this.runtimeDependencies(),
  );
  private readonly imCommandRuntime = createImCommandRuntime(
    this.runtimeDependencies(),
  );
  private runtimeDependencies(): ImServiceDependencies {
    const host = this;
    return {
      get delegationWaits() {
        return host.delegationWaits;
      },
      get: this.get.bind(this),
      get ops() {
        return host.ops;
      },
      grant: this.grant.bind(this),
      put: this.put.bind(this),
      remove: this.remove.bind(this),
      list: this.list.bind(this),
      manage: this.manage.bind(this),
      text: this.text.bind(this),
      reply: this.reply.bind(this),
      get shortWaits() {
        return host.shortWaits;
      },
      get starts() {
        return host.starts;
      },
      set starts(value: ImServiceDependencies["starts"]) {
        host.starts = value;
      },
      checkContext: this.checkContext.bind(this),
      http: this.http.bind(this),
      get closed() {
        return host.closed;
      },
      set closed(value: ImServiceDependencies["closed"]) {
        host.closed = value;
      },
      get secure() {
        return host.secure;
      },
      deliverySecurity: this.deliverySecurity.bind(this),
      get db() {
        return host.db;
      },
      get config() {
        return host.config;
      },
      set config(value: ImServiceDependencies["config"]) {
        host.config = value;
      },
      fullLocalAccess: this.fullLocalAccess.bind(this),
      get replyStreams() {
        return host.replyStreams;
      },
      usesLocalGateway: this.usesLocalGateway.bind(this),
      get slackRuntime() {
        return host.slackRuntime;
      },
      get slackSetup() {
        return host.slackSetup;
      },
      set slackSetup(value: ImServiceDependencies["slackSetup"]) {
        host.slackSetup = value;
      },
      get directory() {
        return host.directory;
      },
      refreshConnection: this.refreshConnection.bind(this),
      get channelStatus() {
        return host.channelStatus;
      },
      set channelStatus(value: ImServiceDependencies["channelStatus"]) {
        host.channelStatus = value;
      },
      serializeAuthorization: this.serializeAuthorization.bind(this),
      pendingAuthorizations: this.pendingAuthorizations.bind(this),
      submitGroupAuthorization: this.submitGroupAuthorization.bind(this),
      cancelDelegationTask: this.cancelDelegationTask.bind(this),
      resolveOutbound: this.resolveOutbound.bind(this),
      groupContext: this.groupContext.bind(this),
      status: this.status.bind(this),
      displaySpaces: this.displaySpaces.bind(this),
      get legacyImports() {
        return host.legacyImports;
      },
      get localSetup() {
        return host.localSetup;
      },
      set localSetup(value: ImServiceDependencies["localSetup"]) {
        host.localSetup = value;
      },
      setupLocalGateway: this.setupLocalGateway.bind(this),
      get token() {
        return host.token;
      },
      set token(value: ImServiceDependencies["token"]) {
        host.token = value;
      },
      get localGateway() {
        return host.localGateway;
      },
      get identities() {
        return host.identities;
      },
      set identities(value: ImServiceDependencies["identities"]) {
        host.identities = value;
      },
      get pairingRequests() {
        return host.pairingRequests;
      },
      set pairingRequests(value: ImServiceDependencies["pairingRequests"]) {
        host.pairingRequests = value;
      },
      get removedConnections() {
        return host.removedConnections;
      },
      set removedConnections(
        value: ImServiceDependencies["removedConnections"],
      ) {
        host.removedConnections = value;
      },
      get spaces() {
        return host.spaces;
      },
      set spaces(value: ImServiceDependencies["spaces"]) {
        host.spaces = value;
      },
      ensureLocalGateway: this.ensureLocalGateway.bind(this),
      savePreparedSettings: this.savePreparedSettings.bind(this),
      prepareSettings: this.prepareSettings.bind(this),
      get state() {
        return host.state;
      },
      set state(value: ImServiceDependencies["state"]) {
        host.state = value;
      },
      taskState: this.taskState.bind(this),
      finalText: this.finalText.bind(this),
      cancelOperations: this.cancelOperations.bind(this),
      restoreBinding: this.restoreBinding.bind(this),
      hasPermissionBlock: this.hasPermissionBlock.bind(this),
      hasDelegationWait: this.hasDelegationWait.bind(this),
      groupEntryKey: this.groupEntryKey.bind(this),
      cancelThreadDelegations: this.cancelThreadDelegations.bind(this),
      replyApprovalResult: this.replyApprovalResult.bind(this),
      get windowsFiles() {
        return host.windowsFiles;
      },
      holdOutbound: this.holdOutbound.bind(this),
      recordNativeFile: this.recordNativeFile.bind(this),
      observedDelegation: this.observedDelegation.bind(this),
      hasBinding: this.hasBinding.bind(this),
      secureContext: this.secureContext.bind(this),
      deleteThread: this.deleteThread.bind(this),
      suspendedWait: this.suspendedWait.bind(this),
    };
  }

  private readonly delegationWaits = new ImDelegationWaits({
    list: () => this.list<DelegationWait>("delegation-waits"),
    put: (wait) => this.put("delegation-waits", wait.id, wait),
  });
  private readonly shortWaits = new Set<string>();
  /** Live reply streaming state per bound thread: accumulated text + 1s throttle. */
  private readonly replyStreams = new Map<
    string,
    {
      text: string;
      turnId: string;
      lastAt: number;
      timer?: ReturnType<typeof setTimeout> | undefined;
    }
  >();
  private delegationSecurity(binding: Binding): string {
    return this.imDelegationRuntime.delegationSecurity(binding);
  }
  canResumeDelegation(id: string): boolean {
    return this.imDelegationRuntime.canResumeDelegation(id);
  }
  private suspendedWait(id: string, threadId: string): boolean {
    return this.imDelegationRuntime.suspendedWait(id, threadId);
  }
  private restoreBinding(threadId: string): void {
    return this.imDelegationRuntime.restoreBinding(threadId);
  }
  hasDelegationWait(threadId: string): boolean {
    return this.imDelegationRuntime.hasDelegationWait(threadId);
  }
  private cancelDelegationTask(
    threadId: string,
    taskId: string,
    stopTurn = true,
  ): Promise<void> {
    return this.imDelegationRuntime.cancelDelegationTask(
      threadId,
      taskId,
      stopTurn,
    );
  }
  cancelThreadDelegations(
    threadId: string,
    currentAssignmentOnly = false,
  ): Promise<boolean> {
    return this.imDelegationRuntime.cancelThreadDelegations(
      threadId,
      currentAssignmentOnly,
    );
  }
  private observedDelegation(task: DelegatedTaskResult): {
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
  } {
    return this.imDelegationRuntime.observedDelegation(task);
  }
  private interruptionReason(wait: DelegationWait): string {
    return this.imDelegationRuntime.interruptionReason(wait);
  }
  private interruptFailedWait(
    wait: DelegationWait,
    stopTurn: boolean,
    turnId?: string,
  ): Promise<boolean> {
    return this.imDelegationRuntime.interruptFailedWait(wait, stopTurn, turnId);
  }
  private drainDelegationWaits(): Promise<void> {
    return this.imDelegationRuntime.drainDelegationWaits();
  }
  private waitForDelegation(
    binding: Binding,
    command: Extract<RemoteOperation, { action: "collaborate" }>["command"],
    callId: string,
    turnId?: string,
  ): Promise<unknown> {
    return this.imDelegationRuntime.waitForDelegation(
      binding,
      command,
      callId,
      turnId,
    );
  }

  private securityReady = false;
  private readonly localGateway: LocalImGateway;
  private slackSetup: SlackSetupService | undefined;
  private localSetup: Promise<unknown> | undefined;
  private quiescing: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private readonly db: DatabaseSync;
  private config: ImSettings;
  private token = "";
  private readonly sessionId = randomUUID();
  private leaseUntil = 0;
  private state: ImStatus["state"] = "disabled";
  private error: string | undefined;
  private identities: ImIdentity[] = [];
  private pairingRequests: NonNullable<ImStatus["pairingRequests"]> = [];
  private channelStatus: unknown[] = [];
  /** Connection ids the gateway confirmed as removed (bot deleted). */
  private removedConnections = new Set<string>();
  private readonly legacyImports = new Map<
    string,
    {
      expiresAt: number;
      gatewayUrl: string;
      config: ReturnType<typeof readLegacyImSettings>[number];
    }
  >();
  private spaces: unknown[] = [];
  private readonly retiredThreads = new Set<string>();
  private reconciled = false;
  private syncingGroups: Promise<void> | undefined;
  private groupConversationError: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private closed = false;
  private starts = new Map<
    string,
    { projectId: string | undefined; remote: boolean; mode: RunMode }
  >();
  private controllers = new Map<string, Set<AbortController>>();
  private validatedSandboxes = new Set<string>();
  private readonly projectWrites = new Map<string, Promise<void>>();
  private readonly activeProjectWrites = new Set<string>();
  private readonly windowsFiles?: WindowsImFiles;
  private get scopedExecutionSupported() {
    return (
      process.platform === "darwin" ||
      (process.platform === "win32" && !!this.windowsFiles?.available())
    );
  }
  constructor(
    private readonly directory: string,
    private readonly secure: SafeStorageAdapter,
    private readonly ops: ImTaskOperations,
    private readonly windowsHelper?: string,
    private readonly slackRuntime?: SlackCliRuntime,
  ) {
    if (process.platform === "win32" && windowsHelper)
      this.windowsFiles = new WindowsImFiles(
        windowsHelper,
        () => this.ops.locale?.() ?? "zh-CN",
      );
    this.localGateway = new LocalImGateway(
      join(directory, "im-gateway"),
      secure,
      () => this.ops.locale?.() ?? "zh-CN",
    );
    this.db = new DatabaseSync(join(directory, "im.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS im_state(namespace TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,value TEXT NOT NULL,PRIMARY KEY(namespace,id));",
    );
    this.config = imSettingsSchema.parse(
      this.get("settings-v3", "current") ??
        this.get("settings-v2", "current") ??
        this.get("settings", "current") ??
        {},
    );
    if (!this.get<boolean>("migrations", "whole-project-reads")) {
      // Preserve the legacy migration's execution-consent reset. Configured
      // reads are now the default; write and shell access still need consent.
      for (const grant of this.config.grants)
        if (grant.security?.scopes.some((scope) => !scope.readPaths.length)) {
          for (const scope of grant.security.scopes) scope.confirmedAt = 0;
          grant.security.confirmedAt = 0;
        }
      this.put("settings", "current", this.config);
      this.put("migrations", "whole-project-reads", true);
    }
    const encrypted = this.get<string>("credentials", "device");
    if (encrypted) {
      try {
        this.token = secure.decryptString(Buffer.from(encrypted, "base64"));
      } catch {
        this.error = this.text("credentialsUnreadable");
      }
    }
    for (const receipt of this.list<Receipt>("receipts"))
      if (receipt.state === "dispatching") {
        receipt.state = "uncertain";
        this.put("receipts", receipt.request.id, receipt);
        this.reply(
          receipt.request,
          this.text("deliveryInterrupted", receipt.request),
          receipt.threadId,
          true,
          "conversation",
          randomUUID(),
          "failed",
        );
      }
  }
  private get<T>(namespace: string, id: string): T | undefined {
    return this.imStateRepository.get<T>(namespace, id);
  }
  private decodeState<T>(raw: string): T {
    return this.imStateRepository.decodeState<T>(raw);
  }
  private put(namespace: string, id: string, value: unknown): void {
    return this.imStateRepository.put(namespace, id, value);
  }
  private list<T>(namespace: string): T[] {
    return this.imStateRepository.list<T>(namespace);
  }
  private remove(namespace: string, id: string): void {
    return this.imStateRepository.remove(namespace, id);
  }
  private executionRequest(binding: Binding): RemoteInvocationContext {
    return this.imSecurityContext.executionRequest(binding);
  }
  private secureContext(
    binding: Binding,
    source: ImSecurityContext["source"] = binding.request.sourceKind ===
    "tool-result"
      ? "tool-result"
      : binding.request.originator
        ? "member"
        : "owner",
  ): ImSecurityContext {
    return this.imSecurityContext.secureContext(binding, source);
  }
  private checkContext(binding: Binding): ExecutionGrant {
    return this.imSecurityContext.checkContext(binding);
  }
  private deliverySecurity(
    context: ImSecurityContext,
  ): NonNullable<ImReply["security"]> {
    return {
      version: IM_SECURITY_VERSION,
      projectId: context.projectId,
      revision: context.revision,
      audience: context.audience,
    };
  }
  private holdOutbound(
    binding: Binding,
    kind: ImOutboundCandidate["kind"],
    body: unknown,
    reason: string,
    id: string = randomUUID(),
  ): ImOutboundCandidate {
    return this.imOutboundRuntime.holdOutbound(binding, kind, body, reason, id);
  }
  private resolveOutbound(
    id: string,
    hash: string,
    approve: boolean,
    text?: string,
  ): Promise<void> {
    return this.imOutboundRuntime.resolveOutbound(id, hash, approve, text);
  }
  private recordNativeFile(
    binding: Binding,
    invocationId: string,
    name: string,
  ): void {
    return this.imOutboundRuntime.recordNativeFile(binding, invocationId, name);
  }
  private deliverApproved(candidate: ImOutboundCandidate): Promise<void> {
    return this.imOutboundRuntime.deliverApproved(candidate);
  }

  status(): ImStatus & {
    connections: unknown[];
    spaces: unknown[];
    remoteTasks: NonNullable<ImStatus["remoteTasks"]>;
  } {
    return this.imGroupPresentation.status();
  }
  private threadConnectionState(
    binding: Binding,
  ): NonNullable<
    NonNullable<ImStatus["remoteTasks"]>[number]["connectionState"]
  > {
    return this.imGroupPresentation.threadConnectionState(binding);
  }
  private retiredGroup(binding: Binding): "dissolved" | "archived" | undefined {
    return this.imGroupPresentation.retiredGroup(binding);
  }
  private groupContext(binding: Binding): {
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
  } {
    return this.imGroupPresentation.groupContext(binding);
  }
  private localActivity(): "online" | "busy" | "waiting-approval" {
    return this.imGroupPresentation.localActivity();
  }
  private displaySpaces(): (
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
  )[] {
    return this.imGroupPresentation.displaySpaces();
  }
  desktopGroupContext(
    threadId: string,
    text: string,
    mode: RunMode,
  ): string | undefined {
    return this.imGroupPresentation.desktopGroupContext(threadId, text, mode);
  }
  start(): void {
    if (this.timer) return;
    // Resume committed operations even when service enablement had not completed.
    for (const operation of this.pendingAuthorizations().filter(
      (op) => op.state === "pending",
    ))
      void this.serializeAuthorization(() =>
        this.submitGroupAuthorization(operation.command),
      ).catch((error) => {
        this.error = errorMessage(error);
      });
    this.timer = setInterval(() => {
      void this.poll();
    }, 2000);
    void this.poll();
    if (this.usesLocalGateway())
      void this.ensureLocalGateway().catch((error) => {
        this.error = errorMessage(error);
      });
  }
  quiesce(): Promise<void> {
    this.quiescing ??= this.shutdown();
    return this.quiescing;
  }
  close(): Promise<void> {
    this.closing ??= this.quiesce().then(() => this.db.close());
    return this.closing;
  }
  private async shutdown(): Promise<void> {
    this.closed = true;
    await this.slackSetup?.close();
    for (const threadId of this.replyStreams.keys())
      this.clearReplyStream(threadId);
    clearInterval(this.timer);
    for (const id of this.controllers.keys()) this.cancelOperations(id);
    while (this.polling)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await this.authorizationTail.catch(() => undefined);
    await this.localSetup?.catch(() => undefined);
    await this.syncingGroups?.catch(() => undefined);
    if (this.token && this.leaseUntil > Date.now())
      await this.http(
        "/v1/device/release",
        "POST",
        {},
        { url: this.config.gatewayUrl, token: this.token },
      ).catch(() => undefined);
    await this.localGateway.close();
  }
  private usesLocalGateway(): boolean {
    return this.imConnectionCoordinator.usesLocalGateway();
  }
  private ensureLocalGateway(): Promise<{
    url: string;
    token: string;
  }> {
    return this.imConnectionCoordinator.ensureLocalGateway();
  }
  private setupLocalGateway(): Promise<ImStatus> {
    return this.imConnectionCoordinator.setupLocalGateway();
  }
  private authorizationTail: Promise<unknown> = Promise.resolve();
  private serializeAuthorization<T>(work: () => Promise<T>): Promise<T> {
    return this.imAuthorizationCoordinator.serializeAuthorization<T>(work);
  }
  private pendingAuthorizations(): ImAuthorizationOperation[] {
    return this.imAuthorizationCoordinator.pendingAuthorizations();
  }
  private pendingAudience(audience: string, except?: string): boolean {
    return this.imAuthorizationCoordinator.pendingAudience(audience, except);
  }
  save(input: unknown): Promise<ImStatus> {
    return this.imConfiguration.save(input);
  }
  private prepareSettings(input: unknown): Promise<ImSettings> {
    return this.imConfiguration.prepareSettings(input);
  }
  private savePreparedSettings(
    settings: ImSettings,
    operation?: ImAuthorizationOperation,
  ): Promise<ImStatus> {
    return this.imConfiguration.savePreparedSettings(settings, operation);
  }
  private applySettingsEffects(settings: ImSettings): Promise<ImStatus> {
    return this.imConfiguration.applySettingsEffects(settings);
  }
  private authorizationSnapshot(command: ImAuthorizationCommand): Promise<{
    credential: {
      url: string;
      token: string;
    };
    group: CollaborationSpace | undefined;
  }> {
    return this.imAuthorizationCoordinator.authorizationSnapshot(command);
  }
  private checkAuthorizationVersions(
    command: ImAuthorizationCommand,
    group?: CollaborationSpace,
    operation?: ImAuthorizationOperation,
  ): void {
    return this.imAuthorizationCoordinator.checkAuthorizationVersions(
      command,
      group,
      operation,
    );
  }
  private authorizationSettings(
    command: ImAuthorizationCommand,
    group: CollaborationSpace,
  ): ImSettings {
    return this.imAuthorizationCoordinator.authorizationSettings(
      command,
      group,
    );
  }
  private submitGroupAuthorization(
    raw: ImAuthorizationCommand,
  ): Promise<ImAuthorizationOperation> {
    return this.imAuthorizationCoordinator.submitGroupAuthorization(raw);
  }

  private http(
    path: string,
    method = "GET",
    body?: unknown,
    credential?: { url: string; token: string },
  ): Promise<Response> {
    return this.imConnectionCoordinator.http(path, method, body, credential);
  }
  manage(input: ImManagement, serialized = false): Promise<unknown> {
    return this.imManagementRuntime.manage(input, serialized);
  }
  previewLegacyIm(path: string): Promise<{
    legacyBindings: number | undefined;
    connections: {
      importId: `${string}-${string}-${string}-${string}-${string}`;
      name: string;
      appId: string;
      domain: "feishu" | "lark";
    }[];
  }> {
    return this.imManagementRuntime.previewLegacyIm(path);
  }
  private fullLocalAccess(
    binding: Binding,
    grant = this.checkContext(binding),
  ): boolean {
    return this.imSecurityContext.fullLocalAccess(binding, grant);
  }
  private grant(binding: Binding): {
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
  } {
    return this.imSecurityContext.grant(binding);
  }
  hasBinding(threadId: string): boolean {
    return this.imSecurityContext.hasBinding(threadId);
  }
  profile(threadId: string): RemoteExecutionProfile | undefined {
    return this.imSecurityContext.profile(threadId);
  }
  prepareLocalTurn(threadId: string, turnId: string): Promise<void> {
    return this.imLocalExecution.prepareLocalTurn(threadId, turnId);
  }

  private renewGroupTurn(binding: Binding): Promise<Binding> {
    return this.imLocalExecution.renewGroupTurn(binding);
  }

  reserveStart(
    threadId: string,
    mode: RunMode,
    remoteOrigin?: boolean,
  ): () => void {
    return this.imLocalExecution.reserveStart(threadId, mode, remoteOrigin);
  }
  authorizeThread(threadId: string, mode: RunMode): void {
    return this.imSecurityContext.authorizeThread(threadId, mode);
  }
  private withProjectWrite<T>(
    threadId: string,
    operation: RemoteOperation,
    mode: RunMode,
    turnId: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    return this.imLocalExecution.withProjectWrite<T>(
      threadId,
      operation,
      mode,
      turnId,
      run,
    );
  }
  cancelOperations(threadId: string): void {
    return this.imLocalExecution.cancelOperations(threadId);
  }
  deleteThread(threadId: string): void {
    return this.imLocalExecution.deleteThread(threadId);
  }
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
  } {
    return this.imSecurityContext.authorizeOperation(
      threadId,
      operation,
      mode,
      turnId,
    );
  }
  operationFingerprint(
    threadId: string,
    operation: RemoteOperation,
    mode: RunMode,
    turnId: string,
  ): string {
    return this.imSecurityContext.operationFingerprint(
      threadId,
      operation,
      mode,
      turnId,
    );
  }
  stop(): void {
    void this.close().catch(() => undefined);
  }
  hasGroupCollaboration(threadId: string): boolean {
    return this.imSecurityContext.hasGroupCollaboration(threadId);
  }
  hasPermissionBlock(threadId: string): boolean {
    return this.imSecurityContext.hasPermissionBlock(threadId);
  }
  operate(
    threadId: string,
    operationInput: RemoteOperation,
    mode: RunMode,
    callId: string,
    turnId?: string,
  ): Promise<unknown> {
    return this.imLocalExecution.operate(
      threadId,
      operationInput,
      mode,
      callId,
      turnId,
    );
  }
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
  } {
    return this.imSecurityContext.blockPermission(threadId, denied, turnId);
  }
  private operateScoped(
    threadId: string,
    operationInput: RemoteOperation,
    mode: RunMode,
    callId: string,
    turnId?: string,
  ): Promise<unknown> {
    return this.imScopedOperations.operateScoped(
      threadId,
      operationInput,
      mode,
      callId,
      turnId,
    );
  }
  private checkSandbox(workspace: string): Promise<void> {
    return this.imLocalExecution.checkSandbox(workspace);
  }
  private text(
    key: ImMessageKey,
    request?: RemoteInvocationContext,
    values: Record<string, string | number> = {},
  ): string {
    return imText(
      request?.locale ?? this.ops.locale?.() ?? "zh-CN",
      key,
      values,
    );
  }
  private conversationKey(request: RemoteInvocationContext): string {
    return this.imCommandRuntime.conversationKey(request);
  }
  private reply(
    request: RemoteInvocationContext,
    text: string,
    taskId?: string,
    final = false,
    visibility: ImReply["visibility"] = "conversation",
    id: string = randomUUID(),
    outcome?: ImReply["outcome"],
    started = false,
    status?: ImReply["status"],
    approval?: ImReply["approval"],
    stream = false,
  ): void {
    return this.imOutboundRuntime.reply(
      request,
      text,
      taskId,
      final,
      visibility,
      id,
      outcome,
      started,
      status,
      approval,
      stream,
    );
  }
  accept(input: unknown): Promise<void> {
    return this.imCommandRuntime.accept(input);
  }
  private drain(): Promise<void> {
    return this.imCommandRuntime.drain();
  }
  private availableProjects(request: RemoteInvocationContext): Project[] {
    return this.imCommandRuntime.availableProjects(request);
  }
  private taskState(
    thread: Thread,
    request = this.get<Binding>("bindings", thread.id)?.request,
  ): string {
    return this.imCommandRuntime.taskState(thread, request);
  }
  private accessibleThread(
    request: RemoteInvocationContext,
    id: string,
    explicit = false,
  ): Thread {
    return this.imCommandRuntime.accessibleThread(request, id, explicit);
  }
  /** Task control returns no project content and survives data-grant revocation. */
  private controllableThread(
    request: RemoteInvocationContext,
    id: string,
  ): Thread {
    return this.imCommandRuntime.controllableThread(request, id);
  }
  private dispatch(receipt: Receipt): Promise<void> {
    return this.imCommandRuntime.dispatch(receipt);
  }
  private attachments(
    request: RemoteInvocationContext,
  ): Promise<PromptAttachment[]> {
    return this.imCommandRuntime.attachments(request);
  }
  observe(events: readonly AgentEvent[]): void {
    return this.imEventObserver.observe(events);
  }
  private observeGroupActivity(event: AgentEvent): void {
    return this.imEventObserver.observeGroupActivity(event);
  }
  private observeEvent(event: AgentEvent): void {
    return this.imEventObserver.observeEvent(event);
  }
  /** Stream live text deltas into throttled non-final replies (1s flush). */
  private observeReplyStream(
    binding: Binding,
    threadId: string,
    turnId: string,
    delta: string,
  ): void {
    return this.imOutboundRuntime.observeReplyStream(
      binding,
      threadId,
      turnId,
      delta,
    );
  }
  private flushReplyStream(binding: Binding, threadId: string): void {
    return this.imOutboundRuntime.flushReplyStream(binding, threadId);
  }
  private clearReplyStream(threadId: string): void {
    return this.imOutboundRuntime.clearReplyStream(threadId);
  }
  private replyApprovalResult(
    binding: Binding,
    action: PendingAction,
    approved: boolean,
    id: string,
  ): void {
    return this.imOutboundRuntime.replyApprovalResult(
      binding,
      action,
      approved,
      id,
    );
  }
  private finalText(
    threadId: string,
    turnId?: string,
    partId?: string,
  ): string {
    return this.imOutboundRuntime.finalText(threadId, turnId, partId);
  }
  poll(): Promise<void> {
    return this.imConnectionCoordinator.poll();
  }
  private completingAuthorization: string | undefined;
  private securitySyncTail: Promise<unknown> = Promise.resolve();
  private syncSecurity(completingOperation?: string): Promise<void> {
    return this.imAuthorizationCoordinator.syncSecurity(completingOperation);
  }
  private sendSecurity(completingOperation?: string): Promise<void> {
    return this.imAuthorizationCoordinator.sendSecurity(completingOperation);
  }
  private applyRetiredGroups(raw: unknown): Promise<void> {
    return this.imGroupSynchronization.applyRetiredGroups(raw);
  }
  private refreshConnection(): Promise<void> {
    return this.imConnectionCoordinator.refreshConnection();
  }
  private refreshNativeHistory(
    threadId: string,
    groupId: string,
  ): Promise<void> {
    return this.imGroupSynchronization.refreshNativeHistory(threadId, groupId);
  }
  private groupEntryKey(spaceId: string): string {
    return this.imGroupSynchronization.groupEntryKey(spaceId);
  }
  private syncGroupConversations(): Promise<void> {
    return this.imGroupSynchronization.syncGroupConversations();
  }
}

export { type ImTaskOperations } from "./im-runtime-types.js";
