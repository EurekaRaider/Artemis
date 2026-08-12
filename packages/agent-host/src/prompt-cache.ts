import { createHash } from "node:crypto";

import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type PromptCachePolicy = "disabled" | "short" | "long" | "explicit-30m";

export type PromptCachePolicyReason =
  | "explicitly-disabled"
  | "official-gpt-5.6"
  | "official-gpt-5.5"
  | "official-legacy-first-turn"
  | "official-legacy-persistent"
  | "child-agent"
  | "non-official-endpoint"
  | "unsupported-model";

export interface PromptCacheResolution {
  policy: PromptCachePolicy;
  reason: PromptCachePolicyReason;
  cacheKey?: string;
  cacheKeyFingerprint?: string;
  systemPromptFingerprint: string;
  toolSchemaFingerprint: string;
  stablePrefixTokens: number;
  cacheKeyRequestsPerMinute: number;
  cacheKeyRateWarning: boolean;
  cacheReadReported: boolean;
  cacheWriteReported: boolean;
}

interface PromptCacheSession {
  scope: "parent" | "child";
  priorTopLevelUserTurns: number;
}

export const ARTEMIS_PROMPT_CACHE_METADATA = "artemisPromptCache";
const CACHE_KEY_WARNING_RPM = 14;
const CACHE_KEY_WINDOW_MILLISECONDS = 60_000;
const LEGACY_LONG_CACHE_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-chat-latest",
  "gpt-5",
  "gpt-5-codex",
  "gpt-4.1",
]);

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

function serializedTools(context: Context): string {
  return JSON.stringify(
    (context.tools ?? [])
      .map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: canonicalValue(definition.parameters),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

function isOfficialOpenAIEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && url.hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function matchesFamily(modelId: string, family: string): boolean {
  return modelId === family || modelId.startsWith(`${family}-`);
}

function addBreakpointToContent(
  content: unknown,
  textType: "input_text" | "text",
): unknown {
  if (typeof content === "string") {
    return [
      {
        type: textType,
        text: content,
        prompt_cache_breakpoint: { mode: "explicit" },
      },
    ];
  }
  if (!Array.isArray(content) || content.length === 0) return content;
  const next = content.map((entry) =>
    entry && typeof entry === "object" ? { ...entry } : entry,
  );
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const entry = next[index];
    if (entry && typeof entry === "object") {
      next[index] = {
        ...entry,
        prompt_cache_breakpoint: { mode: "explicit" },
      };
      break;
    }
  }
  return next;
}

export function injectExplicitPromptCache(
  payload: unknown,
  resolution: PromptCacheResolution,
): unknown {
  if (
    resolution.policy !== "explicit-30m" ||
    !resolution.cacheKey ||
    !payload ||
    typeof payload !== "object"
  ) {
    return payload;
  }
  const next = { ...(payload as Record<string, unknown>) };
  next.prompt_cache_key = resolution.cacheKey;
  next.prompt_cache_options = { mode: "explicit", ttl: "30m" };
  delete next.prompt_cache_retention;

  const field = Array.isArray(next.input)
    ? "input"
    : Array.isArray(next.messages)
      ? "messages"
      : undefined;
  if (!field) return next;
  const messages = (next[field] as unknown[]).map((entry) =>
    entry && typeof entry === "object" ? { ...entry } : entry,
  );
  const systemIndex = messages.findIndex((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const role = (entry as { role?: unknown }).role;
    return role === "system" || role === "developer";
  });
  if (systemIndex >= 0) {
    const message = messages[systemIndex] as Record<string, unknown>;
    messages[systemIndex] = {
      ...message,
      content: addBreakpointToContent(
        message.content,
        field === "input" ? "input_text" : "text",
      ),
    };
    next[field] = messages;
  }
  return next;
}

export function promptCacheMetadata(
  options: SimpleStreamOptions | undefined,
): PromptCacheResolution | undefined {
  const value = options?.metadata?.[ARTEMIS_PROMPT_CACHE_METADATA];
  if (!value || typeof value !== "object") return undefined;
  return value as PromptCacheResolution;
}

export class PromptCacheController {
  private readonly sessions = new Map<string, PromptCacheSession>();
  private readonly requestTimes = new Map<string, number[]>();
  private readonly latest = new Map<string, PromptCacheResolution>();

  registerSession(sessionId: string, session: PromptCacheSession): void {
    this.sessions.set(sessionId, { ...session });
  }

  updateParentTurnCount(
    sessionId: string,
    priorTopLevelUserTurns: number,
  ): void {
    const existing = this.sessions.get(sessionId);
    this.sessions.set(sessionId, {
      scope: existing?.scope ?? "parent",
      priorTopLevelUserTurns: Math.max(0, priorTopLevelUserTurns),
    });
  }

  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.latest.delete(sessionId);
  }

  latestResolution(sessionId: string): PromptCacheResolution | undefined {
    const resolution = this.latest.get(sessionId);
    return resolution ? structuredClone(resolution) : undefined;
  }

  resolve(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
    now = Date.now(),
  ): PromptCacheResolution {
    const sessionId = options?.sessionId ?? "unscoped";
    const session = this.sessions.get(sessionId) ?? {
      scope: "parent" as const,
      priorTopLevelUserTurns: 0,
    };
    const official = isOfficialOpenAIEndpoint(model.baseUrl);
    let policy: PromptCachePolicy;
    let reason: PromptCachePolicyReason;

    if (options?.cacheRetention === "none") {
      policy = "disabled";
      reason = "explicitly-disabled";
    } else if (!official) {
      policy = "short";
      reason = "non-official-endpoint";
    } else if (session.scope === "child") {
      policy = "short";
      reason = "child-agent";
    } else if (matchesFamily(model.id, "gpt-5.6")) {
      policy = "explicit-30m";
      reason = "official-gpt-5.6";
    } else if (
      matchesFamily(model.id, "gpt-5.5") ||
      matchesFamily(model.id, "gpt-5.5-pro")
    ) {
      policy = "long";
      reason = "official-gpt-5.5";
    } else if (LEGACY_LONG_CACHE_MODELS.has(model.id)) {
      if (session.priorTopLevelUserTurns >= 1) {
        policy = "long";
        reason = "official-legacy-persistent";
      } else {
        policy = "short";
        reason = "official-legacy-first-turn";
      }
    } else {
      policy = "short";
      reason = "unsupported-model";
    }

    const systemPrompt = context.systemPrompt ?? "";
    const tools = serializedTools(context);
    const systemPromptFingerprint = digest(systemPrompt).slice(0, 16);
    const toolSchemaFingerprint = digest(tools).slice(0, 16);
    const cacheKey =
      policy === "disabled"
        ? undefined
        : digest(
            JSON.stringify({
              sessionId,
              provider: model.provider,
              model: model.id,
              systemPrompt,
              tools,
            }),
          );
    let cacheKeyRequestsPerMinute = 0;
    if (cacheKey) {
      const cutoff = now - CACHE_KEY_WINDOW_MILLISECONDS;
      for (const [key, timestamps] of this.requestTimes) {
        if ((timestamps.at(-1) ?? 0) <= cutoff) this.requestTimes.delete(key);
      }
      const times = (this.requestTimes.get(cacheKey) ?? []).filter(
        (timestamp) => timestamp > cutoff,
      );
      times.push(now);
      this.requestTimes.set(cacheKey, times);
      cacheKeyRequestsPerMinute = times.length;
    }
    const resolution: PromptCacheResolution = {
      policy,
      reason,
      ...(cacheKey
        ? { cacheKey, cacheKeyFingerprint: cacheKey.slice(0, 16) }
        : {}),
      systemPromptFingerprint,
      toolSchemaFingerprint,
      stablePrefixTokens: Math.ceil(systemPrompt.length / 4),
      cacheKeyRequestsPerMinute,
      cacheKeyRateWarning: cacheKeyRequestsPerMinute >= CACHE_KEY_WARNING_RPM,
      cacheReadReported: official,
      cacheWriteReported: policy === "explicit-30m",
    };
    this.latest.set(sessionId, resolution);
    return resolution;
  }
}

function optionsForResolution(
  options: SimpleStreamOptions | undefined,
  resolution: PromptCacheResolution,
): SimpleStreamOptions {
  const existingOnPayload = options?.onPayload;
  const result: SimpleStreamOptions = {
    ...options,
    metadata: {
      ...options?.metadata,
      [ARTEMIS_PROMPT_CACHE_METADATA]: resolution,
    },
  };
  if (resolution.policy === "disabled") {
    result.cacheRetention = "none";
    return result;
  }
  result.sessionId = resolution.cacheKey!;
  result.cacheRetention =
    resolution.policy === "long"
      ? "long"
      : resolution.policy === "explicit-30m"
        ? "none"
        : "short";
  if (resolution.policy === "explicit-30m") {
    result.onPayload = async (payload, model) => {
      const replacement = await existingOnPayload?.(payload, model);
      return injectExplicitPromptCache(replacement ?? payload, resolution);
    };
  }
  return result;
}

export function withPromptCacheController(
  runtime: ModelRuntime,
  controller: PromptCacheController,
): ModelRuntime {
  return new Proxy(runtime, {
    get(target, property) {
      if (property === "streamSimple") {
        return (
          model: Model<Api>,
          context: Context,
          options?: SimpleStreamOptions,
        ) => {
          const resolution = controller.resolve(model, context, options);
          return target.streamSimple(
            model,
            context,
            optionsForResolution(options, resolution),
          );
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
