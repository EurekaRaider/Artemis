import type { AgentSessionEvent } from "./runtime-types.js";
export const PROVIDER_BACKOFF_DEFAULT_MILLISECONDS = 2_000;

export const PROVIDER_BACKOFF_MAX_MILLISECONDS = 5 * 60_000;

export const MODEL_STREAM_IDLE_TIMEOUT_MILLISECONDS = 120_000;

export const MODEL_STREAM_STALLED_CODE = "MODEL_STREAM_STALLED";

export class ModelStreamIdleTimeoutError extends Error {
  readonly code = MODEL_STREAM_STALLED_CODE;

  constructor(timeoutMilliseconds: number) {
    const duration =
      timeoutMilliseconds % 1_000 === 0
        ? `${timeoutMilliseconds / 1_000} seconds`
        : `${timeoutMilliseconds} ms`;
    super(
      `The model produced no streaming activity for ${duration}. Artemis cancelled the stalled request; retry the turn or choose another model.`,
    );
    this.name = "ModelStreamIdleTimeoutError";
  }
}

export function createModelStreamIdleWatchdog(
  timeoutMilliseconds: number,
  onTimeout: () => void,
): {
  stalled: Promise<never>;
  observe(event: AgentSessionEvent): void;
  pause(): void;
  resume(): void;
  dispose(): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeToolExecutions = 0;
  let paused = false;
  let rejectStalled!: (error: ModelStreamIdleTimeoutError) => void;
  const stalled = new Promise<never>((_resolve, reject) => {
    rejectStalled = reject;
  });
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    if (paused || activeToolExecutions > 0) return;
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      onTimeout();
      rejectStalled(new ModelStreamIdleTimeoutError(timeoutMilliseconds));
    }, timeoutMilliseconds);
  };
  const observe = (event: AgentSessionEvent) => {
    if (event.type === "tool_execution_start") {
      activeToolExecutions += 1;
      clear();
      return;
    }
    if (event.type === "tool_execution_end") {
      activeToolExecutions = Math.max(0, activeToolExecutions - 1);
      if (activeToolExecutions === 0) arm();
      return;
    }
    if (
      (event.type === "message_start" || event.type === "message_end") &&
      event.message.role === "assistant"
    ) {
      arm();
      return;
    }
    if (
      event.type === "message_update" &&
      "delta" in event.assistantMessageEvent &&
      typeof event.assistantMessageEvent.delta === "string" &&
      event.assistantMessageEvent.delta.length > 0
    ) {
      arm();
    }
  };
  arm();
  return {
    stalled,
    observe,
    pause() {
      paused = true;
      clear();
    },
    resume() {
      paused = false;
      arm();
    },
    dispose: clear,
  };
}

export function retryAfterHeader(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    headers?: { get?(name: string): string | null };
    response?: { headers?: { get?(name: string): string | null } };
    retryAfter?: string | number;
  };
  const direct = candidate.headers?.get?.("retry-after");
  const response = candidate.response?.headers?.get?.("retry-after");
  const retryAfter = direct ?? response ?? candidate.retryAfter;
  return retryAfter === undefined || retryAfter === null
    ? undefined
    : String(retryAfter);
}

function clampBackoffMilliseconds(delay: number): number {
  return Math.max(
    0,
    Math.min(PROVIDER_BACKOFF_MAX_MILLISECONDS, Math.ceil(delay)),
  );
}

function parseRetryAfterSecondsOrDate(
  value: string,
  now: number,
): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return clampBackoffMilliseconds(seconds * 1_000);
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    return clampBackoffMilliseconds(date - now);
  }
  return undefined;
}

function headerLookup(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

export function providerResponseRetryDelayMilliseconds(
  status: number,
  headers?: Record<string, string>,
  now = Date.now(),
): number | undefined {
  const retryAfter = headerLookup(headers, "retry-after");
  const retryAfterMs = headerLookup(headers, "retry-after-ms");
  let explicitDelay: number | undefined;
  if (retryAfter !== undefined) {
    explicitDelay = parseRetryAfterSecondsOrDate(retryAfter, now);
  }
  if (explicitDelay === undefined && retryAfterMs !== undefined) {
    const milliseconds = Number(retryAfterMs.trim());
    if (Number.isFinite(milliseconds)) {
      explicitDelay = clampBackoffMilliseconds(milliseconds);
    }
  }
  if (status === 429) {
    return explicitDelay ?? PROVIDER_BACKOFF_DEFAULT_MILLISECONDS;
  }
  if ((status === 503 || status === 529) && explicitDelay !== undefined) {
    return explicitDelay;
  }
  return undefined;
}

export function providerRetryDelayMilliseconds(
  error: unknown,
  now = Date.now(),
): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const header = retryAfterHeader(error);
  if (
    !header &&
    !/(?:\b429\b|rate.?limit|too many requests|retry-after)/iu.test(message)
  ) {
    return undefined;
  }
  const messageSeconds = message.match(
    /retry-after[^\d]{0,12}(\d+(?:\.\d+)?)/iu,
  )?.[1];
  const value = header ?? messageSeconds;
  if (value) {
    const parsed = parseRetryAfterSecondsOrDate(value, now);
    if (parsed !== undefined) return parsed;
  }
  return PROVIDER_BACKOFF_DEFAULT_MILLISECONDS;
}
