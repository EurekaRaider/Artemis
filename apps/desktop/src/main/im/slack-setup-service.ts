import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import {
  imSlackSetupStatusSchema,
  type ImSlackSetupStatus,
} from "@artemis/protocol";
import {
  resolveSlackConnection,
  type ChannelConnection,
} from "@artemis/gateway";
import {
  slackAppManifest,
  slackBotNameKey,
} from "../../shared/slack-manifest.js";
import type { SafeStorageAdapter } from "../settings/encrypted-settings-store.js";
import {
  runSlackCli,
  slackHookCommand,
  type SlackCliCommand,
  type SlackCliResult,
  type SlackCliRuntime,
} from "./slack-cli-runner.js";

const tokensSchema = z.object({
  appToken: z.string().startsWith("xapp-").max(2048),
  botToken: z.string().startsWith("xoxb-").max(2048),
});
const stateSchema = z.object({
  version: z.literal(2),
  id: z.string().uuid(),
  owner: z.string(),
  name: z.string().trim().min(1).max(80),
  status: imSlackSetupStatusSchema.shape.state,
  error: imSlackSetupStatusSchema.shape.error,
  ticket: z.string().optional(),
  expiresAt: z.number().optional(),
  credentials: z.string().optional(),
  teamId: z.string().optional(),
  userId: z.string().optional(),
  appId: z.string().optional(),
  connectionId: z.string(),
  creationAttempted: z.boolean().default(false),
  tokens: tokensSchema.optional(),
});
type State = z.infer<typeof stateSchema>;
type SlackConnection = Extract<ChannelConnection, { channel: "slack" }>;
type PublicError = NonNullable<ImSlackSetupStatus["error"]>;
export interface SlackSetupOptions {
  directory: string;
  secure: SafeStorageAdapter;
  runtime: SlackCliRuntime;
  owner(): string;
  connections?(): Promise<readonly { id: string; name: string }[]>;
  connect(connection: SlackConnection, signal: AbortSignal): Promise<void>;
  run?(command: SlackCliCommand): Promise<SlackCliResult>;
  resolve?(input: unknown, signal: AbortSignal): Promise<SlackConnection>;
}

function cliError(output: string): PublicError {
  if (/challenge|invalid_ticket|ticket_expired|invalid_code/iu.test(output))
    return "invalid-code";
  if (/invalid_auth|token_revoked|not_authed|token_expired/iu.test(output))
    return "invalid-code";
  if (
    /network|timeout|connection|unreachable|http_request_failed|ratelimited|429/iu.test(
      output,
    )
  )
    return "network";
  return "cli-failed";
}

/** One local, recoverable setup transaction. No project code or user CLI state is executed. */
export class SlackSetupService {
  private state: State | undefined;
  private initialized: Promise<void> | undefined;
  private running: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private operations: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private readonly options: SlackSetupOptions) {}
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation, operation);
    this.operations = next.catch(() => undefined);
    return next;
  }
  private get directory() {
    return join(this.options.directory, this.state!.id);
  }
  private get statePath() {
    return join(this.options.directory, "state.enc");
  }
  private async save() {
    if (!this.options.secure.isEncryptionAvailable())
      throw new Error("secure-storage");
    const temporary = `${this.statePath}.tmp`;
    await writeFile(
      temporary,
      this.options.secure.encryptString(JSON.stringify(this.state)),
      { mode: 0o600 },
    );
    await rename(temporary, this.statePath);
  }
  private async initialize() {
    if (this.closed) throw new Error("Slack setup is closed.");
    if (!this.options.secure.isEncryptionAvailable())
      throw new Error("secure-storage");
    this.initialized ??= (async () => {
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      try {
        const saved = JSON.parse(
          this.options.secure.decryptString(await readFile(this.statePath)),
        );
        if (saved.version === 1) {
          saved.name = `${z.string().min(1).max(64).parse(saved.name)}_bot`;
          saved.version = 2;
        }
        this.state = stateSchema.parse(saved);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error(
            "Slack setup state cannot be decrypted; existing state was preserved.",
          );
      }
      if (this.state) {
        await this.captureApp();
        await this.sealCliCredentials();
        if (["authorizing", "configuring"].includes(this.state.status)) {
          this.state.status =
            this.state.creationAttempted && !this.state.appId
              ? "recovery-required"
              : "interrupted";
        }
        await this.save();
      }
    })();
    await this.initialized;
  }
  private checkOwner(id?: string) {
    if (!this.state || (id && this.state.id !== id))
      throw new Error("Slack setup session does not exist.");
    if (this.state.owner !== this.options.owner())
      throw new Error(
        "Slack setup identity does not match this device registration.",
      );
  }
  private publicStatus(): ImSlackSetupStatus {
    const state = this.state;
    if (!state) return { state: "idle" };
    const expired =
      state.status === "awaiting-code" && (state.expiresAt ?? 0) <= Date.now();
    return {
      sessionId: state.id,
      name: state.name,
      connectionId: state.connectionId,
      state: expired
        ? "expired"
        : state.status === "cancelled"
          ? "idle"
          : state.status,
      ...(state.status === "awaiting-code" && !expired && state.ticket
        ? {
            authorizationCommand: `/slackauthticket ${state.ticket}`,
            expiresAt: state.expiresAt!,
          }
        : {}),
      ...(state.appId ? { appId: state.appId } : {}),
      ...(state.error ? { error: state.error } : {}),
    };
  }
  async status(id?: string): Promise<ImSlackSetupStatus> {
    await this.initialize();
    if (this.state) this.checkOwner(id);
    // Do not publish an actionable state while its background operation is
    // still saving: submit/start would otherwise discard the immediate reply.
    if (
      this.running &&
      this.state?.status !== "authorizing" &&
      this.state?.status !== "configuring"
    )
      await this.running;
    return this.publicStatus();
  }
  private launch(work: (signal: AbortSignal) => Promise<void>) {
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.running = work(signal)
      .catch(async (error: unknown) => {
        if (!this.state || this.state.status === "connected") return;
        if (signal.aborted) this.state.status = "interrupted";
        else {
          const code = error instanceof Error ? error.message : "cli-failed";
          this.state.error = imSlackSetupStatusSchema.shape.error.safeParse(
            code,
          ).success
            ? (code as PublicError)
            : "cli-failed";
          this.state.status =
            this.state.creationAttempted && !this.state.appId
              ? "recovery-required"
              : "error";
          if (code === "invalid-code") {
            this.state.credentials = undefined;
            this.state.ticket = undefined;
            this.state.expiresAt = undefined;
            if (this.state.status !== "recovery-required")
              this.state.status = "expired";
          }
        }
        await this.save();
      })
      .finally(() => {
        this.running = undefined;
        this.controller = undefined;
      });
    // Status polling reports errors; background work must never log CLI output.
    void this.running.catch(() => undefined);
  }
  start(name: string, id?: string): Promise<ImSlackSetupStatus> {
    return this.serialize(() => this.startNow(name, id));
  }
  private async startNow(
    name: string,
    id?: string,
  ): Promise<ImSlackSetupStatus> {
    await this.initialize();
    if (this.state) this.checkOwner(id);
    if (this.running) return this.publicStatus();
    name = z.string().trim().min(1).max(35).parse(name);
    if (!this.state || (!id && this.state.status === "connected")) {
      this.state = stateSchema.parse({
        version: 2,
        id: randomUUID(),
        owner: this.options.owner(),
        name,
        status: "idle",
        connectionId: `slack-${randomUUID()}`,
      });
    }
    if (this.state.creationAttempted && !this.state.appId) {
      this.state.status = "recovery-required";
      this.state.error = "recovery";
      await this.save();
      return this.publicStatus();
    }
    if (this.state.name !== name) this.state.tokens = undefined;
    this.state.name = name;
    if (await this.nameTaken()) {
      this.state.status = "error";
      this.state.error = "name-taken";
      await this.save();
      return this.publicStatus();
    }
    this.state.error = undefined;
    if (this.state.tokens || this.state.credentials) {
      this.state.status = "configuring";
      await this.save();
      this.launch((signal) => this.configure(signal));
    } else {
      this.state.status = "authorizing";
      await this.save();
      this.launch(async (signal) => {
        const result = await this.cli(["auth", "login", "--no-prompt"], signal);
        if (result.code !== 0) throw new Error(cliError(result.output));
        const ticket =
          /\/slackauthticket ([a-zA-Z0-9+/=_-]{16,2048})(?:\s|$)/u.exec(
            result.output,
          )?.[1];
        if (!ticket) throw new Error("cli-failed");
        signal.throwIfAborted();
        this.checkOwner();
        this.state!.ticket = ticket;
        this.state!.expiresAt = Date.now() + 10 * 60_000;
        this.state!.status = "awaiting-code";
        await this.save();
      });
    }
    return this.publicStatus();
  }
  submit(id: string, challenge: string): Promise<ImSlackSetupStatus> {
    return this.serialize(() => this.submitNow(id, challenge));
  }
  private async submitNow(
    id: string,
    challenge: string,
  ): Promise<ImSlackSetupStatus> {
    await this.initialize();
    this.checkOwner(id);
    if (this.running) return this.publicStatus();
    const state = this.state!;
    if (!state.ticket || (state.expiresAt ?? 0) <= Date.now()) {
      state.status = "expired";
      await this.save();
      return this.publicStatus();
    }
    if (!/^[a-zA-Z0-9]{6,32}$/u.test(challenge))
      throw new Error("Invalid Slack confirmation code.");
    state.status = "authorizing";
    state.error = undefined;
    await this.save();
    this.launch(async (signal) => {
      const result = await this.cli(
        ["auth", "login", "--ticket", state.ticket!, "--challenge", challenge],
        signal,
      );
      if (result.code !== 0 || !state.credentials) {
        state.status = "awaiting-code";
        state.error = cliError(result.output);
        await this.save();
        return;
      }
      const auths = Object.values(JSON.parse(state.credentials)) as {
        team_id: string;
        user_id: string;
        token: string;
        api_host?: string;
      }[];
      const auth = auths[0];
      if (
        auths.length !== 1 ||
        !auth ||
        !/^T[A-Z0-9]+$/u.test(auth.team_id) ||
        !/^U[A-Z0-9]+$/u.test(auth.user_id) ||
        (auth.api_host && auth.api_host !== "https://slack.com") ||
        (state.teamId && state.teamId !== auth.team_id) ||
        (state.userId && state.userId !== auth.user_id)
      ) {
        state.credentials = undefined;
        throw new Error("identity");
      }
      this.checkOwner();
      state.teamId = auth.team_id;
      state.userId = auth.user_id;
      state.ticket = undefined;
      state.expiresAt = undefined;
      state.status = "configuring";
      await this.save();
      await this.configure(signal);
    });
    return this.publicStatus();
  }
  cancel(id: string): Promise<ImSlackSetupStatus> {
    return this.serialize(() => this.cancelNow(id));
  }
  private async cancelNow(id: string): Promise<ImSlackSetupStatus> {
    await this.initialize();
    this.checkOwner(id);
    this.controller?.abort();
    await this.running;
    if (this.state!.status !== "connected") {
      await this.captureApp();
      this.state!.status = "cancelled";
      this.state!.error = undefined;
      this.state!.ticket = undefined;
      this.state!.expiresAt = undefined;
      this.state!.tokens = undefined;
      await this.cleanupManagement();
      await this.save();
    }
    return this.publicStatus();
  }
  async close(): Promise<void> {
    this.closed = true;
    this.controller?.abort();
    await this.operations;
    this.controller?.abort();
    await this.running;
  }
  private async prepare() {
    const project = join(this.directory, "project");
    await mkdir(join(project, ".slack"), { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    await mkdir(join(this.directory, "config"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      join(project, "manifest.json"),
      slackAppManifest(this.state!.name),
      { mode: 0o600 },
    );
    await writeFile(
      join(project, ".slack", "hooks.json"),
      JSON.stringify({
        hooks: {
          "get-manifest": slackHookCommand(this.options.runtime, "manifest"),
          deploy: slackHookCommand(this.options.runtime, "deploy"),
        },
        config: { "sdk-managed-connection-enabled": true },
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(project, ".slack", "config.json"),
      JSON.stringify({ manifest: { source: "local" } }),
      { mode: 0o600 },
    );
  }
  private async sealCliCredentials() {
    if (!this.state) return;
    const file = join(this.directory, "config", "credentials.json");
    try {
      this.state.credentials = await readFile(file, "utf8");
      await this.save();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("secure-storage");
    } finally {
      await rm(file, { force: true });
      await rm(join(this.directory, "config", "logs"), {
        recursive: true,
        force: true,
      });
    }
  }
  private async cli(
    args: string[],
    signal: AbortSignal,
    handoff?: { port: number; secret: string },
  ) {
    this.checkOwner();
    signal.throwIfAborted();
    await this.prepare();
    if (this.state!.credentials)
      await writeFile(
        join(this.directory, "config", "credentials.json"),
        this.state!.credentials,
        { mode: 0o600 },
      );
    try {
      return await (this.options.run ?? runSlackCli)({
        runtime: this.options.runtime,
        directory: this.directory,
        args,
        signal,
        ...(handoff ? { handoff } : {}),
      });
    } finally {
      try {
        await this.captureApp();
      } finally {
        await this.sealCliCredentials();
      }
    }
  }
  private async captureApp() {
    if (!this.state) return;
    try {
      const saved = JSON.parse(
        await readFile(
          join(this.directory, "project", ".slack", "apps.json"),
          "utf8",
        ),
      );
      const app = saved.apps?.[this.state.teamId ?? ""];
      if (app) {
        if (
          !/^A[A-Z0-9]+$/u.test(app.app_id) ||
          app.team_id !== this.state.teamId ||
          (this.state.appId && this.state.appId !== app.app_id)
        )
          throw new Error("identity");
        this.state.appId = app.app_id;
        await this.save();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("identity");
    }
  }
  private async nameTaken() {
    const state = this.state!;
    const connections = (await this.options.connections?.()) ?? [];
    return connections.some(
      (connection) =>
        connection.id !== state.connectionId &&
        slackBotNameKey(connection.name) === slackBotNameKey(state.name),
    );
  }
  private async configure(signal: AbortSignal) {
    signal.throwIfAborted();
    const state = this.state!;
    if (await this.nameTaken()) throw new Error("name-taken");
    signal.throwIfAborted();
    if (!state.tokens) {
      if (!state.teamId || !state.credentials) throw new Error("invalid-code");
      const secret = randomBytes(32).toString("hex"),
        sockets = new Set<Socket>();
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        sockets.add(socket);
        socket.setTimeout(10000, () => socket.destroy());
        let input = "";
        socket.on("error", () => undefined);
        socket.on("close", () => sockets.delete(socket));
        socket.on("data", (chunk) => {
          input += chunk.toString();
          if (input.length > 8192) socket.destroy();
        });
        socket.on("end", () => {
          try {
            const value = JSON.parse(input);
            if (
              typeof value.secret !== "string" ||
              value.secret.length !== secret.length ||
              !timingSafeEqual(
                Buffer.from(value.secret),
                Buffer.from(secret),
              ) ||
              signal.aborted ||
              state.tokens
            )
              throw new Error("handoff");
            this.checkOwner();
            state.tokens = tokensSchema.parse(value);
            socket.end("ok");
          } catch {
            socket.destroy();
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        signal.throwIfAborted();
        // Persist intent before the non-idempotent remote create. An unknown
        // outcome without apps.json requires recovery instead of another app.
        state.creationAttempted = true;
        await this.save();
        const result = await this.cli(
          [
            "deploy",
            "--team",
            state.teamId,
            "--app",
            state.appId ?? "deployed",
            "--manifest-source",
            "local",
          ],
          signal,
          { port: (server.address() as { port: number }).port, secret },
        );
        signal.throwIfAborted();
        this.checkOwner();
        if (!state.tokens) {
          if (
            /approval|request.*pending|administrator|admin.*approv/iu.test(
              result.output,
            ) &&
            state.appId
          ) {
            state.status = "approval-required";
            await this.save();
            return;
          }
          throw new Error(result.code ? cliError(result.output) : "handoff");
        }
        await this.save();
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    signal.throwIfAborted();
    this.checkOwner();
    if (!state.appId || !state.teamId) throw new Error("identity");
    const connection = await (this.options.resolve ?? resolveSlackConnection)(
      {
        ...state.tokens,
        id: state.connectionId,
        name: state.name,
        channel: "slack",
        enabled: true,
        appId: state.appId,
        tenantId: state.teamId,
      },
      signal,
    ).catch(() => {
      throw new Error("identity");
    });
    signal.throwIfAborted();
    this.checkOwner();
    await this.options.connect(connection, signal).catch(() => {
      throw new Error("connection");
    });
    state.status = "connected";
    state.tokens = undefined;
    state.error = undefined;
    await this.save();
    await this.cleanupManagement();
    await this.save();
  }
  private async cleanupManagement() {
    if (this.state!.credentials) {
      await this.cli(
        ["auth", "logout", "--all"],
        AbortSignal.timeout(15000),
      ).catch(() => undefined);
    }
    this.state!.credentials = undefined;
    await rm(join(this.directory, "config"), { recursive: true, force: true });
  }
}
