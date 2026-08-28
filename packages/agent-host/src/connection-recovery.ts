import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

const CONNECTION_RETRY_BASE_DELAY_MILLISECONDS = 5_000;
const CONNECTION_RETRY_MAX_DELAY_MILLISECONDS = 60_000;

const NON_CONNECTION_FAILURE =
  /\b(?:400|401|403|404|409|422)\b|auth(?:entication|orization)?|invalid (?:request|json|schema)|protocol|quota|billing|insufficient[_ -]?quota|rate.?limit|too many requests|\b429\b/iu;
const CONNECTION_FAILURE =
  /\b(?:ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b|fetch failed|network.?error|connection.?(?:error|refused|lost|reset|closed)|socket (?:hang up|connection was closed)|temporary failure in name resolution|websocket.?(?:closed|error)/iu;
const SENSITIVE_FAILURE_URL = /https?:\/\/[^\s<>"']+/giu;
const SENSITIVE_FAILURE_AUTHORIZATION =
  /\b(authorization|cookie|set-cookie)\b(\s*:\s*)[^\r\n]+/giu;
const SENSITIVE_FAILURE_SECRET =
  /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|secret)\b(\s*[:=]\s*)(["']?)[^\s,;"']+\3/giu;
const SENSITIVE_FAILURE_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const SENSITIVE_FAILURE_WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\r\n<>:"|?*]+/gu;
const SENSITIVE_FAILURE_POSIX_HOME_PATH =
  /\/(?:Users|home)\/[^/\s]+(?:\/[^\s:),]+)*/gu;

export type ConnectionRecoveryUpdate =
  | {
      phase: "reconnecting";
      attempt: number;
      delayMs: number;
      attemptId: string;
    }
  | { phase: "recovered"; attemptId: string }
  | { phase: "interrupted"; attemptId: string };

export interface ConnectionRecoveryOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export function isConnectionFailure(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? "");
  return (
    !NON_CONNECTION_FAILURE.test(message) && CONNECTION_FAILURE.test(message)
  );
}

export function sanitizeModelFailure(value: string): string {
  return value
    .replace(SENSITIVE_FAILURE_URL, "[URL]")
    .replace(
      SENSITIVE_FAILURE_AUTHORIZATION,
      (_match, key: string, separator: string) =>
        `${key}${separator}[REDACTED]`,
    )
    .replace(SENSITIVE_FAILURE_BEARER, "Bearer [REDACTED]")
    .replace(
      SENSITIVE_FAILURE_SECRET,
      (_match, key: string, separator: string) =>
        `${key}${separator}[REDACTED]`,
    )
    .replace(SENSITIVE_FAILURE_WINDOWS_PATH, "[PATH]")
    .replace(SENSITIVE_FAILURE_POSIX_HOME_PATH, "[PATH]");
}

function sanitizedTerminalFailure(
  event: AssistantMessageEvent,
): AssistantMessageEvent {
  if (event.type !== "error" || !event.error.errorMessage) return event;
  return {
    ...event,
    error: {
      ...event.error,
      errorMessage: sanitizeModelFailure(event.error.errorMessage),
    },
  };
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(finish, delayMs);
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function failureMessage(
  model: Model<Api>,
  message: string,
  stopReason: "error" | "aborted" = "error",
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason,
    errorMessage: message,
    timestamp: Date.now(),
  };
}

function terminalFailure(
  model: Model<Api>,
  message: string,
  stopReason: "error" | "aborted" = "error",
): AssistantMessageEvent {
  const error = failureMessage(model, message, stopReason);
  return { type: "error", reason: stopReason, error };
}

let recoverySequence = 0;

function recoveringStream(
  runtime: ModelRuntime,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  onUpdate: (
    sessionId: string | undefined,
    update: ConnectionRecoveryUpdate,
  ) => void,
  recoveryOptions: ConnectionRecoveryOptions,
) {
  const output = createAssistantMessageEventStream();
  const baseDelay =
    recoveryOptions.baseDelayMs ?? CONNECTION_RETRY_BASE_DELAY_MILLISECONDS;
  const maxDelay =
    recoveryOptions.maxDelayMs ?? CONNECTION_RETRY_MAX_DELAY_MILLISECONDS;
  const wait = recoveryOptions.wait ?? waitForRetry;
  const requestId = `${options?.sessionId ?? "request"}:connection:${++recoverySequence}`;

  void (async () => {
    let emittedStart = false;
    let semanticOutput = false;
    let attempt = 0;
    let reconnecting = false;

    while (true) {
      let terminal: AssistantMessageEvent | undefined;
      try {
        const source = runtime.streamSimple(model, context, {
          ...options,
          maxRetries: 0,
        });
        for await (const event of source) {
          if (event.type === "start") {
            if (!emittedStart) {
              emittedStart = true;
              output.push(event);
            }
            continue;
          }
          if (event.type === "error") {
            terminal = event;
            break;
          }
          if (reconnecting) {
            reconnecting = false;
            onUpdate(options?.sessionId, {
              phase: "recovered",
              attemptId: `${requestId}:${attempt}`,
            });
          }
          semanticOutput = true;
          output.push(event);
          if (event.type === "done") return;
        }
      } catch (error) {
        terminal = terminalFailure(
          model,
          error instanceof Error ? error.message : String(error),
        );
      }

      const message =
        terminal?.type === "error" ? terminal.error.errorMessage : undefined;
      if (!terminal || !isConnectionFailure(message)) {
        output.push(
          terminal
            ? sanitizedTerminalFailure(terminal)
            : terminalFailure(model, "The model stream ended unexpectedly."),
        );
        return;
      }
      if (semanticOutput) {
        const attemptId = `${requestId}:unsafe`;
        onUpdate(options?.sessionId, { phase: "interrupted", attemptId });
        output.push(
          terminalFailure(
            model,
            "ARTEMIS_STREAM_INTERRUPTED: Output had already begun, so automatic replay was stopped to avoid duplicate text or tool side effects. Confirm before continuing.",
          ),
        );
        return;
      }

      attempt += 1;
      const delayMs = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const attemptId = `${requestId}:${attempt}`;
      reconnecting = true;
      onUpdate(options?.sessionId, {
        phase: "reconnecting",
        attempt,
        delayMs,
        attemptId,
      });
      try {
        await wait(delayMs, options?.signal);
      } catch {
        output.push(
          terminalFailure(
            model,
            "The reconnect wait was cancelled.",
            "aborted",
          ),
        );
        return;
      }
    }
  })();

  return output;
}

export function withConnectionRecovery(
  runtime: ModelRuntime,
  onUpdate: (
    sessionId: string | undefined,
    update: ConnectionRecoveryUpdate,
  ) => void,
  options: ConnectionRecoveryOptions = {},
): ModelRuntime {
  return new Proxy(runtime, {
    get(target, property) {
      if (property === "streamSimple") {
        return (
          model: Model<Api>,
          context: Context,
          streamOptions?: SimpleStreamOptions,
        ) =>
          recoveringStream(
            target,
            model,
            context,
            streamOptions,
            onUpdate,
            options,
          );
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
