import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import {
  assertImGatewayUrl,
  imConversationKey,
  imIdentityKey,
  imManagementSchema,
  imPairingRequestSchema,
  imSettingsSchema,
  remoteInvocationSchema,
  remoteOperationSchema,
  requireImGrant,
  type AgentEvent,
  type ApprovalResolution,
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
  type UserInputResolution,
  type PromptAttachment,
} from "@artemis/protocol";
import type { SafeStorageAdapter } from "./encrypted-settings-store.js";
import { LocalImGateway } from "./im-local-gateway.js";
import { loadPromptAttachments } from "./prompt-attachments.js";
import {
  buildRemoteShellLaunch,
  checkedRemotePath,
  remoteWriteCommand,
  runRemoteShell,
} from "./im-sandbox.js";

export interface ImTaskOperations {
  projects(): Project[];
  threads(): Thread[];
  thread(id: string): Thread | undefined;
  create(
    id: string,
    projectId: string,
    mode: RunMode,
    title: string,
  ): Promise<Thread>;
  close(id: string): Promise<void>;
  start(
    id: string,
    text: string,
    mode: RunMode,
    attachments: PromptAttachment[],
  ): Promise<void>;
  queue(
    id: string,
    text: string,
    attachments: PromptAttachment[],
  ): Promise<void>;
  cancel(id: string): Promise<void>;
  approve(resolution: ApprovalResolution): Promise<void>;
  answer(resolution: UserInputResolution): void;
  events(id: string): AgentEvent[];
  ready(): boolean;
}
interface Binding {
  threadId: string;
  projectId: string;
  request: RemoteInvocationContext;
}
interface Receipt {
  request: RemoteInvocationContext;
  state: "pending" | "dispatching" | "done" | "uncertain";
  threadId?: string;
}
interface PendingAction {
  token: string;
  threadId: string;
  identity: string;
  expiresAt: number;
  payload: Extract<
    AgentEvent["payload"],
    { type: "approval.requested" | "user-input.requested" }
  >;
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const busy = (thread: Thread) =>
  thread.status === "running" || thread.status === "waiting-approval";

/** The desktop owns grants and task invocation; Gateway data never carries local paths or tool credentials. */
export class ImService {
  private readonly localGateway: LocalImGateway;
  private localSetup: Promise<unknown> | undefined;
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
  private spaces: unknown[] = [];
  private reconciled = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private closed = false;
  private starts = new Map<string, { projectId: string; remote: boolean }>();
  private controllers = new Map<string, Set<AbortController>>();
  private validatedSandboxes = new Set<string>();
  constructor(
    private readonly directory: string,
    private readonly secure: SafeStorageAdapter,
    private readonly ops: ImTaskOperations,
    private readonly windowsHelper?: string,
  ) {
    this.localGateway = new LocalImGateway(
      join(directory, "im-gateway"),
      secure,
    );
    this.db = new DatabaseSync(join(directory, "im.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS im_state(namespace TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,value TEXT NOT NULL,PRIMARY KEY(namespace,id));",
    );
    this.config = imSettingsSchema.parse(this.get("settings", "current") ?? {});
    const encrypted = this.get<string>("credentials", "device");
    if (encrypted) {
      try {
        this.token = secure.decryptString(Buffer.from(encrypted, "base64"));
      } catch {
        this.error = "设备凭据无法解密，请重新注册设备。";
      }
    }
    for (const receipt of this.list<Receipt>("receipts"))
      if (receipt.state === "dispatching") {
        receipt.state = "uncertain";
        this.put("receipts", receipt.request.id, receipt);
        this.reply(
          receipt.request,
          "桌面在任务投递过程中中断。为避免重复外部操作，没有自动重放；请先 /status 核对任务，再明确继续。",
          receipt.threadId,
          true,
          "conversation",
          randomUUID(),
          "failed",
        );
      }
  }
  private get<T>(namespace: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT value,version FROM im_state WHERE namespace=? AND id=?")
      .get(namespace, id);
    if (!row) return undefined;
    if (row.version !== 1) throw new Error("Unsupported IM state version.");
    return JSON.parse(String(row.value)) as T;
  }
  private put(namespace: string, id: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO im_state(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value",
      )
      .run(namespace, id, JSON.stringify(value));
  }
  private list<T>(namespace: string): T[] {
    return this.db
      .prepare("SELECT value FROM im_state WHERE namespace=? ORDER BY rowid")
      .all(namespace)
      .map((row) => JSON.parse(String(row.value)) as T);
  }
  private remove(namespace: string, id: string): void {
    this.db
      .prepare("DELETE FROM im_state WHERE namespace=? AND id=?")
      .run(namespace, id);
  }
  status(): ImStatus & {
    connections: unknown[];
    spaces: unknown[];
    remoteTasks: Array<{ threadId: string; channel: string; kind: string }>;
  } {
    return {
      settings: structuredClone(this.config),
      ...(this.usesLocalGateway()
        ? {
            localGateway: {
              state: this.localGateway.url
                ? ("running" as const)
                : this.error
                  ? ("error" as const)
                  : ("stopped" as const),
            },
          }
        : {}),
      state: this.config.enabled ? this.state : "disabled",
      ...(this.error ? { error: this.error } : {}),
      identities: structuredClone(this.identities),
      pairingRequests: structuredClone(this.pairingRequests),
      connections: structuredClone(this.channelStatus),
      spaces: structuredClone(this.spaces),
      remoteTasks: this.list<Binding>("bindings").map((b) => ({
        threadId: b.threadId,
        channel: b.request.identity.channel,
        kind: b.request.conversation.kind,
      })),
    };
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, 2000);
    void this.poll();
    if (this.usesLocalGateway())
      void this.ensureLocalGateway().catch((error) => {
        this.error = errorMessage(error);
      });
  }
  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }
  private async shutdown(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    for (const id of this.controllers.keys()) this.cancelOperations(id);
    while (this.polling)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await this.localSetup?.catch(() => undefined);
    if (this.token && this.leaseUntil > Date.now())
      await this.http(
        "/v1/device/release",
        "POST",
        {},
        { url: this.config.gatewayUrl, token: this.token },
      ).catch(() => undefined);
    await this.localGateway.close();
    this.db.close();
  }
  private usesLocalGateway(): boolean {
    return (
      !!this.config.deviceId &&
      this.get<string>("gateway", "local-device") === this.config.deviceId
    );
  }
  private async ensureLocalGateway() {
    if (this.closed) throw new Error("IM service is shutting down.");
    const credential = await this.localGateway.start();
    if (this.closed) throw new Error("IM service is shutting down.");
    if (this.usesLocalGateway() && this.config.gatewayUrl !== credential.url) {
      this.config = { ...this.config, gatewayUrl: credential.url };
      this.put("settings", "current", this.config);
    }
    return credential;
  }
  private async setupLocalGateway(): Promise<ImStatus> {
    if (this.config.enabled && !this.usesLocalGateway())
      throw new Error("请先暂停当前 IM 连接，再切换到内置 Gateway。");
    const credential = await this.ensureLocalGateway();
    if (!this.usesLocalGateway()) {
      await this.manage({
        action: "register",
        gatewayUrl: credential.url,
        adminToken: credential.token,
        name: this.config.deviceName,
      });
      this.put("gateway", "local-device", this.config.deviceId);
    }
    await this.refreshConnection();
    this.error = undefined;
    return this.status();
  }
  async save(input: unknown): Promise<ImStatus> {
    const settings = imSettingsSchema.parse(input);
    if (settings.deviceId !== this.config.deviceId)
      throw new Error("Register the device before changing its identity.");
    if (settings.gatewayUrl !== this.config.gatewayUrl && this.token)
      throw new Error("Register separately when changing Gateways.");
    if (settings.enabled) {
      assertImGatewayUrl(settings.gatewayUrl);
      if (!this.token || !settings.deviceId)
        throw new Error("请先注册当前设备。");
    }
    const projects = this.ops.projects();
    if (
      settings.grants.some(
        (grant) => !projects.some((p) => p.id === grant.projectId),
      )
    )
      throw new Error("Grant references an unavailable project.");
    if (
      settings.defaultProjectId &&
      !settings.grants.some(
        (grant) => grant.projectId === settings.defaultProjectId,
      )
    )
      throw new Error("Default project must be authorized.");
    if (
      new Set(settings.grants.map((g) => g.projectId)).size !==
      settings.grants.length
    )
      throw new Error("Duplicate project grants are not allowed.");
    for (const grant of settings.grants)
      if (grant.mode === "execute")
        await this.checkSandbox(
          projects.find((p) => p.id === grant.projectId)!.path,
        );
    this.config = settings;
    this.put("settings", "current", settings);
    // Revoke before cancellation: no new tool request can pass while cancellation is in flight.
    for (const binding of this.list<Binding>("bindings")) {
      try {
        this.grant(binding);
      } catch {
        this.cancelOperations(binding.threadId);
        if (
          this.ops.thread(binding.threadId) &&
          busy(this.ops.thread(binding.threadId)!)
        )
          await this.ops.cancel(binding.threadId);
      }
    }
    if (!settings.enabled) {
      this.state = "disabled";
      if (this.token && this.leaseUntil > Date.now())
        await this.http("/v1/device/release", "POST", {}).catch(
          () => undefined,
        );
      this.leaseUntil = 0;
    }
    return this.status();
  }
  private async http(
    path: string,
    method = "GET",
    body?: unknown,
    credential?: { url: string; token: string },
  ): Promise<Response> {
    if (!credential && this.usesLocalGateway()) await this.ensureLocalGateway();
    const requestedAt = Date.now();
    const origin = assertImGatewayUrl(
      credential?.url ?? this.config.gatewayUrl,
    ).origin;
    const response = await fetch(origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${credential?.token ?? this.token}`,
        "X-Artemis-Device": this.config.deviceId,
        "X-Artemis-Session": this.sessionId,
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 409)
        this.leaseUntil = 0;
      const result = await response.json().catch(() => ({}));
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : `Gateway returned ${response.status}.`,
      );
    }
    // Use the local request time, independent of the Gateway's clock. A slow response only shortens this lease.
    const lease = Number(response.headers.get("x-artemis-lease-until"));
    if (lease > 0) this.leaseUntil = requestedAt + 40000;
    return response;
  }
  async manage(input: ImManagement): Promise<unknown> {
    const action = imManagementSchema.parse(input);
    if (action.action === "setup-local") {
      this.localSetup ??= this.setupLocalGateway().finally(() => {
        this.localSetup = undefined;
      });
      return this.localSetup;
    }
    if (action.action === "export-gateway")
      throw new Error("Gateway export requires the desktop save dialog.");
    if (action.action === "refresh") {
      await this.refreshConnection();
      return this.status();
    }
    if (action.action === "register") {
      if (this.config.enabled)
        throw new Error("Pause IM before changing device registration.");
      if (!this.secure.isEncryptionAvailable())
        throw new Error("系统凭据加密不可用，无法保存设备凭据。");
      const value = z
        .object({ id: z.string().uuid(), token: z.string().min(32) })
        .parse(
          await (
            await this.http(
              "/v1/admin/register",
              "POST",
              { name: action.name },
              { url: action.gatewayUrl, token: action.adminToken },
            )
          ).json(),
        );
      for (const namespace of [
        "outbox",
        "receipts",
        "selections",
        "actions",
        "subscriptions",
        "usage",
      ]) {
        this.db
          .prepare("DELETE FROM im_state WHERE namespace=?")
          .run(namespace);
      }
      this.token = value.token;
      this.put(
        "credentials",
        "device",
        this.secure.encryptString(value.token).toString("base64"),
      );
      this.config = {
        ...this.config,
        gatewayUrl: assertImGatewayUrl(action.gatewayUrl).origin,
        deviceId: value.id,
        deviceName: action.name,
      };
      this.put("settings", "current", this.config);
      this.remove("gateway", "local-device");
      if (
        this.localGateway.url &&
        this.config.gatewayUrl !== this.localGateway.url
      )
        await this.localGateway.close();
      this.identities = [];
      this.pairingRequests = [];
      this.channelStatus = [];
      this.spaces = [];
      return this.status();
    }
    if (action.action === "admin") {
      const credential = this.usesLocalGateway()
        ? await this.ensureLocalGateway()
        : action.adminToken
          ? { url: this.config.gatewayUrl, token: action.adminToken }
          : undefined;
      if (!credential) throw new Error("远程 Gateway 需要管理员凭据。");
      return (
        await this.http(
          `/v1/admin/${action.operation}`,
          action.operation === "status" ? "GET" : "PUT",
          action.operation === "status" ? undefined : action.configuration,
          credential,
        )
      ).json();
    }
    if (action.action === "unpair") {
      const result = await (
        await this.http("/v1/device/unpair", "POST", action.identity)
      ).json();
      this.identities = this.identities.filter(
        (identity) =>
          imIdentityKey(identity) !== imIdentityKey(action.identity),
      );
      for (const binding of this.list<Binding>("bindings"))
        if (
          imIdentityKey(binding.request.identity) ===
          imIdentityKey(action.identity)
        ) {
          this.cancelOperations(binding.threadId);
          if (
            this.ops.thread(binding.threadId) &&
            busy(this.ops.thread(binding.threadId)!)
          )
            await this.ops.cancel(binding.threadId);
        }
      return result;
    }
    if (action.action === "resolve-pairing") {
      const result = await (
        await this.http("/v1/device/resolve-pairing", "POST", {
          requestId: action.requestId,
          approve: action.approve,
        })
      ).json();
      await this.refreshConnection();
      return result;
    }
    return (
      await this.http("/v1/device/pair", "POST", {
        requireConfirmation: action.requireConfirmation,
      })
    ).json();
  }
  private grant(binding: Binding) {
    if (this.leaseUntil <= Date.now())
      throw new Error(
        "Gateway device lease is unavailable. Reconnect before executing remote work.",
      );
    if (
      !this.identities.some(
        (i) => imIdentityKey(i) === imIdentityKey(binding.request.identity),
      )
    )
      throw new Error("IM 身份已解除绑定。");
    if (binding.request.conversation.spaceRevision) {
      const space = this.spaces.find(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          (value as { id?: string }).id ===
            binding.request.conversation.spaceId,
      ) as { revision?: string; confirmed?: boolean } | undefined;
      if (
        !space?.confirmed ||
        space.revision !== binding.request.conversation.spaceRevision
      )
        throw new Error("协作空间共享范围已改变，请重新发起任务。");
    }
    const grant = requireImGrant(
      this.config,
      binding.request,
      binding.projectId,
    );
    if (
      (this.get<number>("usage", binding.request.id) ?? 0) >= grant.tokenBudget
    )
      throw new Error("远程任务已达到主人设置的令牌预算。");
    return grant;
  }
  profile(threadId: string): RemoteExecutionProfile | undefined {
    const binding = this.get<Binding>("bindings", threadId);
    if (!binding) return undefined;
    // A persisted remote task stays remote even while disabled or revoked.
    const grant = this.config.grants.find(
      (g) => g.projectId === binding.projectId,
    );
    return { network: grant?.network ?? false, shell: grant?.shell ?? false };
  }
  reserveStart(threadId: string, mode: RunMode): () => void {
    const thread = this.ops.thread(threadId),
      remote = !!this.profile(threadId);
    if (!thread?.projectId || mode !== "execute") return () => {};
    for (const [id, pending] of this.starts)
      if (
        id !== threadId &&
        pending.projectId === thread.projectId &&
        (remote || pending.remote)
      )
        throw new Error("Project is starting another write task.");
    if (
      !remote &&
      this.ops
        .threads()
        .some(
          (t) =>
            t.id !== threadId &&
            t.projectId === thread.projectId &&
            t.mode === "execute" &&
            busy(t) &&
            !!this.profile(t.id),
        )
    )
      throw new Error("Project is executing a remote write task.");
    this.starts.set(threadId, { projectId: thread.projectId, remote });
    return () => {
      this.starts.delete(threadId);
    };
  }
  authorizeThread(threadId: string, mode: RunMode): void {
    const binding = this.get<Binding>("bindings", threadId);
    if (!binding) return;
    const grant = this.grant(binding);
    if (mode === "execute" && grant.mode !== "execute")
      throw new Error("Remote Execute is not authorized for this project.");
    if (
      this.ops
        .threads()
        .some(
          (t) =>
            t.id !== threadId &&
            t.projectId === binding.projectId &&
            t.mode === "execute" &&
            busy(t),
        )
    )
      throw new Error("此项目正在执行另一个写任务；远程任务等待项目空闲。");
  }
  cancelOperations(threadId: string): void {
    for (const controller of this.controllers.get(threadId) ?? [])
      controller.abort();
  }
  deleteThread(threadId: string): void {
    // A live remote task must never lose its execution boundary.
    if (this.ops.thread(threadId))
      throw new Error("Delete the task before removing its IM state.");
    this.cancelOperations(threadId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE im_state SET value=json_remove(value,'$.threadId') WHERE namespace='selections' AND json_extract(value,'$.threadId')=?",
        )
        .run(threadId);
      for (const namespace of ["bindings", "subscriptions", "progress-time"])
        this.remove(namespace, threadId);
      for (const action of this.list<PendingAction>("actions"))
        if (action.threadId === threadId) this.remove("actions", action.token);
      // Keep receipts and assignment links: redelivery must not recreate a deleted task.
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  authorizeOperation(
    threadId: string,
    operation: RemoteOperation,
    mode: RunMode,
  ) {
    const binding = this.get<Binding>("bindings", threadId);
    if (!binding) throw new Error("Remote tool is unavailable in this task.");
    this.authorizeThread(threadId, mode);
    const grant = this.grant(binding);
    if (
      operation.action !== "read" &&
      (mode !== "execute" || grant.mode !== "execute")
    )
      throw new Error(
        "Plan and Review cannot execute or publish remote operations.",
      );
    if (operation.action === "shell" && !grant.shell)
      throw new Error("Remote shell is not authorized.");
    return grant;
  }
  stop(): void {
    void this.close().catch(() => undefined);
  }
  async operate(
    threadId: string,
    operationInput: RemoteOperation,
    mode: RunMode,
    callId: string,
  ): Promise<unknown> {
    const operation = remoteOperationSchema.parse(operationInput),
      binding = this.get<Binding>("bindings", threadId);
    if (!binding) throw new Error("Remote tool is unavailable in this task.");
    this.authorizeThread(threadId, mode);
    const grant = this.grant(binding);
    if (
      operation.action !== "read" &&
      (mode !== "execute" || grant.mode !== "execute")
    )
      throw new Error(
        "Plan and Review cannot execute or publish remote operations.",
      );
    if (operation.action === "shell" && !grant.shell)
      throw new Error("Remote shell is not authorized.");
    if (operation.action === "collaborate")
      return (
        await this.http("/v1/device/collaborate", "POST", {
          id: callId,
          invocationId: binding.request.id,
          threadId,
          command: operation.command,
        })
      ).json();
    const receiptKey = JSON.stringify([threadId, callId]);
    const previous = this.get<{
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
    const project = this.ops.projects().find((p) => p.id === binding.projectId);
    if (!project) throw new Error("Project no longer exists.");
    const workspace = await realpath(project.path);
    await this.checkSandbox(workspace);
    this.grant(binding);
    const path =
      operation.action === "shell"
        ? undefined
        : await checkedRemotePath(workspace, operation.path);
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const command =
      operation.action === "shell"
        ? operation.command
        : operation.action === "write"
          ? remoteWriteCommand(path!, operation.content)
          : process.platform === "win32"
            ? `[System.IO.File]::ReadAllText('${path!.replaceAll("'", "''")}')`
            : `/bin/cat ${quote(path!)}`;
    const controller = new AbortController();
    const set = this.controllers.get(threadId) ?? new Set<AbortController>();
    set.add(controller);
    this.controllers.set(threadId, set);
    const expiry = setInterval(() => {
      if (
        Date.now() >=
        Math.min(binding.request.expiresAt, grant.expiresAt, this.leaseUntil)
      )
        controller.abort();
    }, 500);
    this.put("operations", receiptKey, { state: "started", operation });
    try {
      const result = await runRemoteShell(
        buildRemoteShellLaunch(
          workspace,
          command,
          operation.action === "shell" && grant.network,
          process.platform,
          this.windowsHelper,
          operation.action === "read" ? "plan" : "execute",
        ),
        controller.signal,
        operation.action === "shell" ? operation.timeoutSeconds : 30,
      );
      this.put("operations", receiptKey, { state: "done", operation, result });
      return result;
    } finally {
      clearTimeout(expiry);
      set.delete(controller);
      if (!set.size) this.controllers.delete(threadId);
    }
  }
  private async checkSandbox(workspace: string): Promise<void> {
    workspace = await realpath(workspace);
    if (this.validatedSandboxes.has(workspace)) return;
    const marker = "ARTEMIS_REMOTE_SANDBOX_READY";
    const command =
      process.platform === "win32"
        ? `Write-Output '${marker}'`
        : `printf ${marker}`;
    const result = await runRemoteShell(
      buildRemoteShellLaunch(
        workspace,
        command,
        false,
        process.platform,
        this.windowsHelper,
      ),
      new AbortController().signal,
      10,
    );
    if (result.exitCode !== 0 || result.output.trim() !== marker)
      throw new Error(
        "原生沙箱验证失败，远程 Execute 未开放。" + result.output.slice(0, 300),
      );
    const probe = await mkdtemp(join(tmpdir(), "artemis-im-sandbox-"));
    try {
      const outside = await realpath(probe),
        part = relative(workspace, outside);
      if (!part.startsWith("..") && !isAbsolute(part))
        throw new Error(
          "Project scope is too broad to verify remote filesystem isolation.",
        );
      const file = join(outside, "private-probe.txt"),
        secret = randomUUID();
      await writeFile(file, secret, { mode: 0o600 });
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      const attempt =
        process.platform === "win32"
          ? `Get-Content '${file.replaceAll("'", "''")}'; Set-Content '${file.replaceAll("'", "''")}' 'changed'`
          : `cat ${quote(file)}; printf changed > ${quote(file)}`;
      const denied = await runRemoteShell(
        buildRemoteShellLaunch(
          workspace,
          attempt,
          false,
          process.platform,
          this.windowsHelper,
        ),
        new AbortController().signal,
        10,
      );
      if (
        denied.output.includes(secret) ||
        (await readFile(file, "utf8")) !== secret
      )
        throw new Error(
          "Native sandbox failed project isolation checks. Remote Execute is unavailable.",
        );
      this.validatedSandboxes.add(workspace);
    } finally {
      await rm(probe, { recursive: true, force: true });
    }
  }
  private conversationKey(request: RemoteInvocationContext): string {
    return JSON.stringify([
      imIdentityKey(request.identity),
      imConversationKey(request.conversation),
    ]);
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
  ): void {
    const reply: ImReply = {
      version: 1,
      id,
      invocationId: request.id,
      text: text.slice(0, 64000),
      visibility,
      final,
      ...(started ? { started: true } : {}),
      ...(status || started || final
        ? { status: status ?? (started ? "running" : (outcome ?? "completed")) }
        : {}),
      ...(outcome ? { outcome } : {}),
      ...(taskId ? { taskId } : {}),
    };
    this.put("outbox", reply.id, reply);
  }
  async accept(input: unknown): Promise<void> {
    const request = remoteInvocationSchema.parse(input);
    if (request.deviceId !== this.config.deviceId)
      throw new Error("Request targets another device.");
    if (!this.get("receipts", request.id))
      this.put("receipts", request.id, {
        request,
        state: "pending",
      } satisfies Receipt);
    await this.drain();
  }
  private async drain(): Promise<void> {
    if (!this.ops.ready()) return;
    for (const receipt of this.list<Receipt>("receipts").filter(
      (r) => r.state === "pending",
    )) {
      if (!this.config.enabled) return;
      if (
        this.get<Receipt>("receipts", receipt.request.id)?.state !== "pending"
      )
        continue;
      const request = receipt.request;
      if (request.expiresAt <= Date.now()) {
        receipt.state = "done";
        this.put("receipts", request.id, receipt);
        this.reply(
          request,
          "请求已过期，请重新发送。",
          undefined,
          true,
          "conversation",
          randomUUID(),
          "failed",
        );
        continue;
      }
      try {
        await this.dispatch(receipt);
      } catch (error) {
        receipt.state = "done";
        this.put("receipts", request.id, receipt);
        this.reply(
          request,
          errorMessage(error),
          receipt.threadId,
          true,
          "conversation",
          randomUUID(),
          "failed",
        );
      }
    }
  }
  private availableProjects(request: RemoteInvocationContext): Project[] {
    return this.ops.projects().filter((project) => {
      try {
        requireImGrant(this.config, request, project.id);
        return true;
      } catch {
        return false;
      }
    });
  }
  private taskState(thread: Thread): string {
    if (thread.status === "running") return "正在执行";
    if (thread.status === "waiting-approval") return "等待确认";
    if (thread.status === "failed") return "失败";
    const payload = this.ops
      .events(thread.id)
      .filter(
        (e) =>
          e.payload.type === "turn.completed" ||
          e.payload.type === "turn.failed",
      )
      .at(-1)?.payload;
    return payload?.type === "turn.completed"
      ? payload.reason === "cancelled"
        ? "已停止"
        : "完成"
      : payload?.type === "turn.failed"
        ? "失败"
        : "空闲";
  }
  private accessibleThread(
    request: RemoteInvocationContext,
    id: string,
    explicit = false,
  ): Thread {
    const thread = this.ops.thread(id);
    if (!thread?.projectId || thread.archived || thread.target !== "local")
      throw new Error("任务不可访问。");
    requireImGrant(this.config, request, thread.projectId);
    const binding = this.get<Binding>("bindings", id);
    if (
      binding &&
      (imIdentityKey(binding.request.identity) !==
        imIdentityKey(request.identity) ||
        imConversationKey(binding.request.conversation) !==
          imConversationKey(request.conversation))
    )
      throw new Error("任务属于其他身份或会话。");
    if (!binding && (!explicit || request.conversation.kind !== "direct"))
      throw new Error("请在本人单聊使用 /continue 任务编号 明确选择桌面任务。");
    return thread;
  }
  private async dispatch(receipt: Receipt): Promise<void> {
    const request = receipt.request;
    if (request.originator && request.text.startsWith("/"))
      throw new Error(
        "Other participants cannot submit owner control commands.",
      );
    if (request.control === "cancel") {
      if (!request.collaboration)
        throw new Error("Cancellation must name an assignment.");
      for (const pending of this.list<Receipt>("receipts"))
        if (
          pending.state === "pending" &&
          pending.request.id !== request.id &&
          pending.request.collaboration?.taskId === request.collaboration.taskId
        ) {
          this.put("receipts", pending.request.id, {
            ...pending,
            state: "done",
          });
        }
      const threadId = request.collaboration
        ? this.get<string>("assignments", request.collaboration.taskId)
        : undefined;
      if (threadId) {
        this.cancelOperations(threadId);
        await this.ops.cancel(threadId);
        this.reply(
          request,
          "停止请求已处理，请以任务的实际结束状态为准。",
          threadId,
        );
      } else
        this.reply(
          request,
          "分派已取消，未启动本地任务。",
          undefined,
          true,
          "conversation",
          randomUUID(),
          "cancelled",
        );
      receipt.state = "done";
      this.put("receipts", request.id, receipt);
      return;
    }
    if (
      !this.identities.some(
        (i) => imIdentityKey(i) === imIdentityKey(request.identity),
      )
    )
      throw new Error("请先完成本人 IM 身份配对。");
    const key = this.conversationKey(request),
      selection =
        this.get<{ projectId?: string; threadId?: string }>(
          "selections",
          key,
        ) ?? {};
    const match =
      (request.collaboration && !request.taskId) || request.originator
        ? null
        : /^\/(\S+)(?:\s+([\s\S]*))?$/u.exec(request.text.trim());
    const command = match?.[1]?.toLowerCase(),
      argument = match?.[2]?.trim() ?? "";
    const complete = (text: string, id?: string, started = false) => {
      receipt.state = "done";
      this.put("receipts", request.id, receipt);
      this.reply(
        request,
        text,
        id,
        false,
        "conversation",
        randomUUID(),
        undefined,
        started,
      );
    };
    if (command === "help") {
      complete(
        "/projects 查看授权项目\n/project 项目编号 切换项目\n/new 任务内容 新建任务\n/tasks 查看任务\n/continue 任务编号 选择并订阅任务\n/status [任务编号] 查看状态\n/stop [任务编号] 停止任务\n/approve 确认码 yes|no 处理审批\n/answer 确认码 [问题编号] 答案 回答澄清\n/publish [任务编号] 相对路径 发布选定文件（15 分钟链接）\n/unsubscribe 停止当前会话回传\n群聊仅处理 @ 入口；引用机器人消息或使用 /continue 继续对应任务。",
      );
      return;
    }
    const projects = this.availableProjects(request);
    if (command === "projects") {
      complete(
        projects.length
          ? projects.map((p) => `${p.name} · ${p.id}`).join("\n")
          : "尚未授权任何项目，请在 Artemis 的 IM 连接设置中授权。",
      );
      return;
    }
    if (command === "project") {
      const project = projects.find((p) => p.id === argument);
      if (!project) throw new Error("请使用 /projects 中的完整项目编号。");
      this.put("selections", key, { projectId: project.id });
      complete(`当前项目：${project.name}`);
      return;
    }
    if (command === "approve" || command === "answer") {
      if (request.conversation.kind !== "direct")
        throw new Error("审批和澄清请在本人单聊或桌面处理。");
      const [token, ...parts] = argument.split(/\s+/u);
      const action = this.get<PendingAction>("actions", token ?? "");
      if (
        !action ||
        action.identity !== imIdentityKey(request.identity) ||
        action.expiresAt <= Date.now()
      )
        throw new Error("确认码无效、已处理或已过期。");
      const binding = this.get<Binding>("bindings", action.threadId);
      if (!binding || !this.ops.thread(action.threadId))
        throw new Error("审批任务已失效。");
      this.grant(binding);
      const p = action.payload;
      if (command === "approve" && p.type === "approval.requested") {
        if (!["yes", "no"].includes(parts.join(" ")))
          throw new Error("使用 /approve 确认码 yes 或 no。");
        await this.ops.approve({
          approvalId: p.approvalId,
          nonce: p.nonce,
          approved: parts[0] === "yes",
          scope: "once",
          source: "user",
        });
        this.remove("actions", action.token);
      } else if (command === "answer" && p.type === "user-input.requested") {
        if (p.kind === "multi-question") {
          const questionId = parts.shift();
          if (!p.questions.some((q) => q.questionId === questionId))
            throw new Error("请指定机器人给出的问题编号。");
          this.ops.answer({
            kind: "multi-question",
            requestId: p.requestId,
            nonce: p.nonce,
            questionId: questionId!,
            customAnswer: parts.join(" "),
          });
        } else {
          this.ops.answer({
            requestId: p.requestId,
            nonce: p.nonce,
            customAnswer: parts.join(" "),
          });
          this.remove("actions", action.token);
        }
      } else throw new Error("确认码与操作类型不符。");
      complete("已提交，桌面与 IM 共用一次性确认状态。", action.threadId);
      return;
    }
    if (command === "publish") {
      if (this.usesLocalGateway())
        throw new Error(
          "文件下载链接需要可访问的 HTTPS Gateway。请在设置中连接团队服务或部署独立运行包后再发布。",
        );
      if (request.originator)
        throw new Error("Only the owner can publish a file.");
      const parts = argument.split(/\s+/u);
      const hasId = !!this.ops.thread(parts[0] ?? "");
      const id = hasId ? parts.shift() : (selection.threadId ?? request.taskId);
      if (!id || !parts.length)
        throw new Error(
          "使用 /publish [任务编号] 项目内相对路径。链接 15 分钟内有效，对此会话的所有成员可见。",
        );
      const thread = this.accessibleThread(request, id);
      const project = projects.find((p) => p.id === thread.projectId);
      if (!project) throw new Error("Project is not authorized.");
      const path = await checkedRemotePath(project.path, parts.join(" "));
      await this.checkSandbox(project.path);
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      const command =
        process.platform === "win32"
          ? `[Convert]::ToBase64String([System.IO.File]::ReadAllBytes('${path.replaceAll("'", "''")}'))`
          : `/usr/bin/base64 < ${quote(path)}`;
      const result = await runRemoteShell(
        buildRemoteShellLaunch(
          await realpath(project.path),
          command,
          false,
          process.platform,
          this.windowsHelper,
          "plan",
        ),
        new AbortController().signal,
        30,
        14 * 1024 * 1024,
      );
      if (result.exitCode !== 0 || result.cancelled)
        throw new Error("无法读取待发布产物，或文件超过大小限制。");
      requireImGrant(this.config, request, project.id);
      const artifact = await (
        await this.http("/v1/device/artifacts", "POST", {
          invocationId: request.id,
          name: basename(path),
          data: result.output.replace(/\s/gu, ""),
        })
      ).json();
      complete(
        `${basename(path)}\n${assertImGatewayUrl(this.config.gatewayUrl).origin}${artifact.path}\nSHA-256: ${artifact.sha256}\n链接 15 分钟后失效，请勿转发到授权范围外。`,
        thread.id,
      );
      return;
    }
    if (command === "tasks") {
      const tasks = this.ops
        .threads()
        .filter(
          (t) => !t.archived && projects.some((p) => p.id === t.projectId),
        )
        .filter((t) => {
          const b = this.get<Binding>("bindings", t.id);
          return b
            ? imIdentityKey(b.request.identity) ===
                imIdentityKey(request.identity) &&
                imConversationKey(b.request.conversation) ===
                  imConversationKey(request.conversation)
            : request.conversation.kind === "direct";
        });
      complete(
        tasks
          .slice(0, 30)
          .map((t) => `${t.title} · ${this.taskState(t)}\n${t.id}`)
          .join("\n") || "暂无可访问任务。",
      );
      return;
    }
    if (command === "unsubscribe") {
      if (selection.threadId) this.remove("subscriptions", selection.threadId);
      this.put("selections", key, {
        ...(selection.projectId ? { projectId: selection.projectId } : {}),
      });
      complete("已停止当前任务向此会话回传。");
      return;
    }
    let threadId =
      request.taskId ??
      (request.collaboration
        ? this.get<string>("assignments", request.collaboration.taskId)
        : undefined) ??
      (request.conversation.kind === "direct" ? selection.threadId : undefined);
    if (["status", "stop", "continue"].includes(command ?? "") && argument)
      threadId = argument;
    if (command === "status" || command === "stop") {
      if (!threadId) throw new Error("请指定任务编号。");
      const thread = this.accessibleThread(request, threadId);
      if (command === "stop") {
        this.cancelOperations(thread.id);
        await this.ops.cancel(thread.id);
      }
      complete(
        `${thread.title} · ${this.ops.thread(thread.id) ? this.taskState(this.ops.thread(thread.id)!) : "已删除"}`,
        thread.id,
      );
      return;
    }
    if (command === "continue") {
      if (!threadId) throw new Error("请指定完整任务编号。");
      const thread = this.accessibleThread(request, threadId, true);
      if (!this.get("bindings", thread.id)) {
        if (busy(thread)) throw new Error("请等待桌面任务结束后再接管到 IM。");
        await this.ops.close(thread.id);
      }
      this.put("bindings", thread.id, {
        threadId: thread.id,
        projectId: thread.projectId!,
        request,
      } satisfies Binding);
      this.put("subscriptions", thread.id, true);
      this.put("selections", key, {
        projectId: thread.projectId,
        threadId: thread.id,
      });
      complete(
        `已选择 ${thread.title}。后续消息会进入此任务，新的进展回传到本会话。`,
        thread.id,
      );
      return;
    }
    if (command && command !== "new")
      throw new Error("未知指令，发送 /help 查看操作。");
    if (command === "new") threadId = undefined;
    else if (
      threadId &&
      !request.taskId &&
      !request.collaboration &&
      !request.originator &&
      request.conversation.kind === "direct" &&
      !this.ops.thread(threadId)
    ) {
      // Recover selections persisted before deletion cleanup was introduced.
      this.deleteThread(threadId);
      threadId = undefined;
    }
    const existing = threadId
      ? this.accessibleThread(request, threadId)
      : undefined;
    const projectId =
      existing?.projectId ??
      selection.projectId ??
      (projects.some((p) => p.id === this.config.defaultProjectId)
        ? this.config.defaultProjectId
        : projects.length === 1
          ? projects[0]!.id
          : undefined);
    if (!projectId)
      throw new Error(
        "请先 /projects 查看项目，然后 /project 项目编号 明确选择。",
      );
    const grant = requireImGrant(this.config, request, projectId);
    if (
      this.ops
        .threads()
        .some(
          (t) =>
            t.id !== threadId &&
            t.projectId === projectId &&
            t.mode === "execute" &&
            busy(t),
        )
    ) {
      if (!this.get("queued-notices", request.id)) {
        this.reply(
          request,
          "项目已有写任务，当前请求已排队；设备恢复或项目空闲后会重新检查授权。",
        );
        this.put("queued-notices", request.id, true);
      }
      return;
    }
    const text =
      command === "new"
        ? argument
        : request.originator
          ? `[协作成员 ${request.originator.channel}:${request.originator.userId}]\n${request.text}`
          : request.text;
    if (!text.trim() && !request.attachments.length)
      throw new Error("任务内容不能为空。");
    const attachments = await this.attachments(request); // Validation completes before any task is started.
    if (existing) this.accessibleThread(request, existing.id);
    receipt.threadId = threadId ?? receipt.threadId ?? randomUUID();
    receipt.state = "dispatching";
    this.put("receipts", request.id, receipt);
    // create() may eagerly open Pi and notify the renderer. Its remote boundary must already exist.
    const binding: Binding = { threadId: receipt.threadId, projectId, request };
    this.grant(binding);
    this.put("bindings", receipt.threadId, binding);
    let thread = existing ?? this.ops.thread(receipt.threadId);
    if (!thread)
      thread = await this.ops.create(
        receipt.threadId,
        projectId,
        grant.mode,
        `${{ wecom: "企业微信", feishu: "飞书", slack: "Slack" }[request.identity.channel]} · ${text.slice(0, 60) || "IM 附件任务"}`,
      );
    if (!this.ops.thread(thread.id))
      throw new Error("任务已删除，请重新发送消息新建任务。");
    this.put("subscriptions", thread.id, true);
    if (request.collaboration)
      this.put("assignments", request.collaboration.taskId, thread.id);
    if (request.conversation.kind === "direct")
      this.put("selections", key, { projectId, threadId: thread.id });
    this.grant(binding);
    const wasBusy = busy(thread);
    if (wasBusy) await this.ops.queue(thread.id, text, attachments);
    else
      await this.ops.start(
        thread.id,
        `${existing ? "" : `[IM 来源：${request.identity.channel} · ${request.conversation.kind}]\n`}${text}`,
        grant.mode,
        attachments,
      );
    complete(
      `${wasBusy ? "已追加到任务队列" : "已启动任务"}：${thread.id}`,
      thread.id,
      !wasBusy,
    );
  }
  private async attachments(
    request: RemoteInvocationContext,
  ): Promise<PromptAttachment[]> {
    if (!request.attachments.length) return [];
    const directory = await mkdtemp(join(this.directory, "im-attachments-"));
    try {
      const paths: string[] = [];
      let total = 0;
      for (let index = 0; index < request.attachments.length; index++) {
        const response = await this.http(
          `/v1/device/attachment?invocationId=${encodeURIComponent(request.id)}&index=${index}`,
        );
        if (Number(response.headers.get("content-length")) > 10 * 1024 * 1024)
          throw new Error("附件超过 10 MiB。");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body!) {
          size += chunk.length;
          total += chunk.length;
          if (size > 10 * 1024 * 1024 || total > 20 * 1024 * 1024)
            throw new Error("附件超出大小限制。");
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        let name = basename(
          decodeURIComponent(
            response.headers.get("x-artemis-name") ??
              request.attachments[index]!.name,
          ),
        );
        if (
          !name ||
          name.length > 200 ||
          name.includes("\\") ||
          name === "." ||
          name === ".."
        )
          throw new Error("附件名称无效。");
        if (request.attachments[index]!.kind === "image") {
          const extension = bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "png"
            : bytes[0] === 255 && bytes[1] === 216
              ? "jpg"
              : bytes.subarray(0, 3).toString() === "GIF"
                ? "gif"
                : bytes.subarray(0, 4).toString() === "RIFF" &&
                    bytes.subarray(8, 12).toString() === "WEBP"
                  ? "webp"
                  : undefined;
          if (!extension)
            throw new Error("Unsupported or invalid image attachment.");
          name = `image.${extension}`;
        }
        const path = join(directory, `${index}-${name}`);
        await writeFile(path, bytes, { mode: 0o600 });
        paths.push(path);
      }
      return await loadPromptAttachments(paths);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  observe(events: readonly AgentEvent[]): void {
    if (this.closed) return;
    for (const event of events) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.observeEvent(event);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }
  private observeEvent(event: AgentEvent): void {
    const binding = this.get<Binding>("bindings", event.threadId);
    if (!binding || !this.get("subscriptions", event.threadId)) return;
    if (this.get("observed", event.eventId)) return;
    this.put("observed", event.eventId, true);
    const payload = event.payload;
    if (payload.type === "assistant.usage") {
      this.put(
        "usage",
        binding.request.id,
        (this.get<number>("usage", binding.request.id) ?? 0) +
          payload.totalTokens,
      );
      return;
    }
    if (
      payload.type === "approval.requested" ||
      payload.type === "user-input.requested"
    ) {
      const action: PendingAction = {
        token: randomUUID(),
        threadId: event.threadId,
        identity: imIdentityKey(binding.request.identity),
        expiresAt: Date.now() + 300000,
        payload,
      };
      this.put("actions", action.token, action);
      const detail =
        payload.type === "approval.requested"
          ? `${payload.summary}\n/approve ${action.token} yes|no`
          : payload.kind === "multi-question"
            ? payload.questions
                .map(
                  (q) =>
                    `${q.questionId}: ${q.question}\n${q.options.map((o) => o.label).join(" / ")}\n/answer ${action.token} ${q.questionId} 答案`,
                )
                .join("\n")
            : `${payload.question}\n${payload.options.map((o) => o.label).join(" / ")}\n/answer ${action.token} 答案`;
      this.reply(
        binding.request,
        `任务 ${event.threadId}\n${detail}`,
        event.threadId,
        false,
        "owner",
        event.eventId,
      );
      this.reply(
        binding.request,
        `任务 ${event.threadId}\n等待该 Agent 的主人确认。`,
        event.threadId,
        false,
        "conversation",
        `${event.eventId}:status`,
        undefined,
        false,
        "waiting",
      );
      return;
    }
    if (
      payload.type === "approval.resolved" ||
      payload.type === "user-input.resolved"
    ) {
      let resolvedAction = false;
      for (const action of this.list<PendingAction>("actions")) {
        const p = action.payload;
        if (action.threadId !== event.threadId) continue;
        if (
          payload.type === "user-input.resolved" &&
          payload.kind === "multi-question" &&
          p.type === "user-input.requested" &&
          p.kind === "multi-question" &&
          p.requestId === payload.requestId
        ) {
          resolvedAction = true;
          p.questions = p.questions.filter(
            (q) => q.questionId !== payload.questionId,
          );
          if (p.questions.length) this.put("actions", action.token, action);
          else this.remove("actions", action.token);
          continue;
        }
        if (
          (payload.type === "approval.resolved" &&
            p.type === "approval.requested" &&
            payload.approvalId === p.approvalId) ||
          (payload.type === "user-input.resolved" &&
            p.type === "user-input.requested" &&
            payload.requestId === p.requestId &&
            payload.kind !== "multi-question")
        ) {
          resolvedAction = true;
          this.remove("actions", action.token);
        }
      }
      if (
        resolvedAction &&
        !this.list<PendingAction>("actions").some(
          (action) => action.threadId === event.threadId,
        )
      )
        this.reply(
          binding.request,
          `任务 ${event.threadId}\n确认已处理，正在继续任务。`,
          event.threadId,
          false,
          "conversation",
          `${event.eventId}:status`,
          undefined,
          false,
          "running",
        );
      return;
    }
    if (
      payload.type === "tool.started" &&
      Date.now() - (this.get<number>("progress-time", event.threadId) ?? 0) >
        30000
    ) {
      const progress = this.finalText(event.threadId, event.turnId);
      if (progress) {
        this.reply(binding.request, progress.slice(-2000), event.threadId);
        this.put("progress-time", event.threadId, Date.now());
      }
    }
    if (payload.type === "turn.completed" || payload.type === "turn.failed") {
      const finalText =
        payload.type === "turn.failed"
          ? `任务失败：${payload.message}`
          : payload.reason === "cancelled"
            ? "任务已停止。"
            : this.finalText(
                event.threadId,
                event.turnId,
                payload.finalPartId,
              ) || "任务已完成，请在 Artemis 查看成果。";
      this.reply(
        binding.request,
        finalText,
        event.threadId,
        true,
        "conversation",
        event.eventId,
        payload.type === "turn.failed"
          ? "failed"
          : payload.reason === "cancelled"
            ? "cancelled"
            : "completed",
      );
    }
  }
  private finalText(
    threadId: string,
    turnId?: string,
    partId?: string,
  ): string {
    const events = this.ops
      .events(threadId)
      .filter(
        (e) => e.turnId === turnId && e.payload.type === "message.part.delta",
      );
    const parts = new Map<string, string>();
    for (const event of events) {
      const p = event.payload;
      if (p.type === "message.part.delta" && p.partType === "text")
        parts.set(p.partId, (parts.get(p.partId) ?? "") + p.delta);
    }
    return partId
      ? (parts.get(partId) ?? "")
      : ([...parts.values()].at(-1) ?? "");
  }
  async poll(): Promise<void> {
    if (this.polling || this.closed || !this.config.enabled || !this.token)
      return;
    this.polling = true;
    this.state = this.state === "connected" ? "connected" : "connecting";
    try {
      await this.refreshConnection();
      if (this.closed) return;
      for (const binding of this.list<Binding>("bindings"))
        try {
          this.grant(binding);
        } catch {
          this.cancelOperations(binding.threadId);
          if (
            this.ops.thread(binding.threadId) &&
            busy(this.ops.thread(binding.threadId)!)
          )
            await this.ops.cancel(binding.threadId);
        }
      const inbox = await (await this.http("/v1/device/inbox")).json();
      for (const input of z
        .array(remoteInvocationSchema)
        .parse(inbox.requests)) {
        if (!this.get("receipts", input.id))
          this.put("receipts", input.id, {
            request: input,
            state: "pending",
          } satisfies Receipt);
        await this.http("/v1/device/ack", "POST", { id: input.id });
      }
      if (this.closed) return;
      if (!this.reconciled && this.ops.ready()) {
        for (const binding of this.list<Binding>("bindings"))
          this.observe(this.ops.events(binding.threadId));
        this.reconciled = true;
      }
      await this.drain();
      for (const reply of this.list<ImReply>("outbox")) {
        await this.http("/v1/device/reply", "POST", reply);
        this.remove("outbox", reply.id);
      }
      this.state = "connected";
      this.error = undefined;
    } catch (error) {
      this.state = "error";
      this.error = errorMessage(error);
      if (!this.closed && this.leaseUntil <= Date.now())
        for (const binding of this.list<Binding>("bindings")) {
          this.cancelOperations(binding.threadId);
          const thread = this.ops.thread(binding.threadId);
          if (thread && busy(thread))
            await this.ops.cancel(binding.threadId).catch(() => undefined);
        }
    } finally {
      this.polling = false;
    }
  }
  private async refreshConnection(): Promise<void> {
    if (!this.token || !this.config.deviceId) return;
    const status = await (await this.http("/v1/device/status")).json();
    this.identities = z
      .array(remoteInvocationSchema.shape.identity)
      .parse(status.identities);
    this.pairingRequests = z
      .array(imPairingRequestSchema)
      .parse(status.pairingRequests ?? []);
    this.channelStatus = Array.isArray(status.connections)
      ? status.connections
      : [];
    this.spaces = Array.isArray(status.spaces) ? status.spaces : [];
  }
}
