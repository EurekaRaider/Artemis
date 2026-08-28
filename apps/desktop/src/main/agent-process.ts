import type { UtilityProcess } from "electron";
import { utilityProcess } from "electron";
import {
  AGENT_CONCURRENCY_FALLBACK,
  AGENT_CONCURRENCY_MAXIMUM,
  AGENT_CONCURRENCY_MINIMUM,
  type AgentHostCommand,
  type AgentHostMessage,
  type BrokerExecutionRequest,
} from "@artemis/protocol";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface AgentProcessHandlers {
  onEvent(
    threadId: string,
    turnId: string | undefined,
    payload: Extract<AgentHostMessage, { type: "event" }>["payload"],
  ): void;
  onEvents?(
    events: Extract<AgentHostMessage, { type: "events" }>["events"],
  ): void;
  onTurnTelemetry?(event: {
    threadId: string;
    turnId: string;
    stage: "host-received";
    timestamp: number;
  }): void;
  onThreadSession?(threadId: string, sessionFile: string): void;
  onBrokerRequest(
    requestId: string,
    request: BrokerExecutionRequest,
  ): Promise<void>;
  onStderr?(data: string): void;
  onExit?(code: number | null, expected: boolean): void;
}

export interface AgentProcessOptions {
  codexRuntimeRoot?: string;
  agentConcurrencyLimit?: number;
}

const AGENT_HOST_SECRET =
  /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|secret)\b(\s*[:=]\s*)(["']?)[^\s,;"']+\3/giu;
const AGENT_HOST_AUTHORIZATION =
  /\bAuthorization\b(\s*:\s*)(?:Bearer\s+)?[^\s,;"']+/giu;
const AGENT_HOST_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const AGENT_HOST_URL = /https?:\/\/[^\s<>"']+/giu;
const AGENT_HOST_WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\r\n<>:"|?*]+/gu;
const AGENT_HOST_POSIX_HOME_PATH =
  /\/(?:Users|home)\/[^/\s]+(?:\/[^\s:),]+)*/gu;

export function sanitizeAgentHostDiagnostic(value: string): string {
  return value
    .replace(AGENT_HOST_URL, "[URL]")
    .replace(
      AGENT_HOST_AUTHORIZATION,
      (_match, separator: string) => `Authorization${separator}[REDACTED]`,
    )
    .replace(AGENT_HOST_BEARER, "Bearer [REDACTED]")
    .replace(
      AGENT_HOST_SECRET,
      (_match, key: string, separator: string) =>
        `${key}${separator}[REDACTED]`,
    )
    .replace(AGENT_HOST_WINDOWS_PATH, "[PATH]")
    .replace(AGENT_HOST_POSIX_HOME_PATH, "[PATH]");
}

export class AgentProcess {
  private readonly child: UtilityProcess;
  private readonly pending = new Map<string, PendingRequest>();
  private disposing = false;
  private exitError: Error | undefined;

  constructor(
    workerPath: string,
    private readonly handlers: AgentProcessHandlers,
    options: AgentProcessOptions = {},
  ) {
    const agentConcurrencyLimit =
      options.agentConcurrencyLimit ?? AGENT_CONCURRENCY_FALLBACK;
    if (
      !Number.isInteger(agentConcurrencyLimit) ||
      agentConcurrencyLimit < AGENT_CONCURRENCY_MINIMUM ||
      agentConcurrencyLimit > AGENT_CONCURRENCY_MAXIMUM
    ) {
      throw new Error(
        `Agent concurrency limit must be an integer from ${AGENT_CONCURRENCY_MINIMUM} to ${AGENT_CONCURRENCY_MAXIMUM}.`,
      );
    }
    this.child = utilityProcess.fork(workerPath, [], {
      serviceName: "Artemis Pi Agent Host",
      stdio: "pipe",
      env: {
        ...process.env,
        ...(options.codexRuntimeRoot
          ? { ARTEMIS_CODEX_RUNTIME_ROOT: options.codexRuntimeRoot }
          : {}),
        ARTEMIS_AGENT_CONCURRENCY_LIMIT: String(agentConcurrencyLimit),
      },
    });
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (data: string) => {
      const sanitized = sanitizeAgentHostDiagnostic(data);
      console.error(`[Artemis Agent Host] ${sanitized.trimEnd()}`);
      this.handlers.onStderr?.(sanitized);
    });
    this.child.on("message", (message) => {
      void this.handleMessage(message as AgentHostMessage);
    });
    this.child.on("exit", (code) => {
      const error = new Error(
        `Agent host exited with code ${code ?? "unknown"}.`,
      );
      this.exitError = error;
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      this.handlers.onExit?.(code, this.disposing);
    });
  }

  get available(): boolean {
    return !this.exitError && !this.disposing;
  }

  request<T = unknown>(
    command: AgentHostCommand,
    timeoutMilliseconds?: number,
  ): Promise<T> {
    if (this.exitError) {
      return Promise.reject(this.exitError);
    }
    if (this.disposing) {
      return Promise.reject(new Error("Agent host is shutting down."));
    }
    return new Promise<T>((resolve, reject) => {
      const timeout =
        timeoutMilliseconds === undefined
          ? undefined
          : setTimeout(() => {
              if (!this.pending.delete(command.requestId)) return;
              reject(
                new Error(
                  `Agent host request timed out after ${timeoutMilliseconds} ms: ${command.type}`,
                ),
              );
            }, timeoutMilliseconds);
      this.pending.set(command.requestId, {
        resolve: (value) => {
          if (timeout) clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          if (timeout) clearTimeout(timeout);
          reject(error);
        },
      });
      this.child.postMessage(command);
    });
  }

  post(command: AgentHostCommand): void {
    if (this.exitError) {
      throw this.exitError;
    }
    if (this.disposing) {
      throw new Error("Agent host is shutting down.");
    }
    this.child.postMessage(command);
  }

  private async handleMessage(message: AgentHostMessage): Promise<void> {
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }
      this.pending.delete(message.requestId);
      if (message.ok) {
        pending.resolve(message.data);
      } else {
        pending.reject(new Error(message.error));
      }
      return;
    }
    if (message.type === "event") {
      this.handlers.onEvent(message.threadId, message.turnId, message.payload);
      return;
    }
    if (message.type === "events") {
      if (this.handlers.onEvents) {
        this.handlers.onEvents(message.events);
      } else {
        for (const event of message.events) {
          this.handlers.onEvent(event.threadId, event.turnId, event.payload);
        }
      }
      return;
    }
    if (message.type === "turn.telemetry") {
      this.handlers.onTurnTelemetry?.(message);
      return;
    }
    if (message.type === "thread.session") {
      this.handlers.onThreadSession?.(message.threadId, message.sessionFile);
      return;
    }
    await this.handlers.onBrokerRequest(message.requestId, message.request);
  }

  dispose(): void {
    this.disposing = true;
    this.child.kill();
  }
}
