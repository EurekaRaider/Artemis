import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

import type { AgentConcurrencyStatus } from "../shared/agent-concurrency.js";

const gzipAsync = promisify(gzip);

export type DiagnosticSource = "main" | "renderer" | "agent-host";
export type DiagnosticSeverity = "info" | "warning" | "error" | "fatal";

export interface DiagnosticEventInput {
  source: DiagnosticSource;
  severity: DiagnosticSeverity;
  message: string;
  stack?: string;
}

interface DiagnosticEvent extends DiagnosticEventInput {
  timestamp: string;
}

export interface TurnLatencySample {
  timestamp: string;
  outcome: "completed" | "failed";
  coldThread: boolean;
  providerId?: string;
  modelId?: string;
  thinkingLevel?: string;
  mode: string;
  enabledMcpServers: number;
  toolCount: number;
  mcpToolCount: number;
  queueDepth: number;
  eventCount: number;
  contextTokens?: number;
  cacheReadTokens?: number;
  stagesMs: {
    submitToMain?: number;
    localPreModel?: number;
    optionalCapabilities?: number;
    workspaceResolve?: number;
    threadOpen?: number;
    memoryRecall?: number;
    hostDispatch?: number;
    queueWait?: number;
    modelToFirstActivity?: number;
    modelToFirstText?: number;
    mainToRendererPaint?: number;
    total?: number;
  };
}

export interface DiagnosticBundleContext {
  appVersion: string;
  platform: string;
  architecture: string;
  locale: string;
  projectCount: number;
  threadCount: number;
  activeTurnCount: number;
  agentConcurrency: AgentConcurrencyStatus;
}

interface PersistedDiagnostics {
  version: 1 | 2;
  events: DiagnosticEvent[];
  turnLatency?: TurnLatencySample[];
}

const SECRET_ASSIGNMENT =
  /\b(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|secret|authorization[-_ ]?code|code[-_ ]?verifier)\b(\s*[:=]\s*)(["']?)[^\s,;"']+\3/giu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\r\n<>:"|?*]+/gu;
const POSIX_HOME_PATH = /\/(?:Users|home)\/[^/\s]+(?:\/[^\s:),]+)*/gu;

function redact(value: string, sensitiveRoots: readonly string[]): string {
  let result = value;
  for (const root of [...sensitiveRoots].sort(
    (left, right) => right.length - left.length,
  )) {
    if (!root) continue;
    result = result.replaceAll(root, "[PATH]");
  }
  return result
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(
      SECRET_ASSIGNMENT,
      (_match, key: string, separator: string) =>
        `${key}${separator}[REDACTED]`,
    )
    .replace(WINDOWS_PATH, "[PATH]")
    .replace(POSIX_HOME_PATH, "[PATH]");
}

function boundedText(value: string, maximumBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  return buffer.byteLength <= maximumBytes
    ? value
    : `${buffer.subarray(0, maximumBytes).toString("utf8")}\n[TRUNCATED]`;
}

function metric(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
}

const LATENCY_STAGE_NAMES = [
  "submitToMain",
  "localPreModel",
  "optionalCapabilities",
  "workspaceResolve",
  "threadOpen",
  "memoryRecall",
  "hostDispatch",
  "queueWait",
  "modelToFirstActivity",
  "modelToFirstText",
  "mainToRendererPaint",
  "total",
] as const satisfies readonly (keyof TurnLatencySample["stagesMs"])[];

export class DiagnosticBundleService {
  private events: DiagnosticEvent[];
  private turnLatency: TurnLatencySample[];

  constructor(
    private readonly statePath: string,
    private readonly sensitiveRoots: readonly string[],
    private readonly maximumEvents = 200,
  ) {
    const loaded = this.load();
    this.events = loaded.events;
    this.turnLatency = loaded.turnLatency;
  }

  recordTurnLatency(sample: TurnLatencySample): void {
    try {
      this.turnLatency.push(this.sanitizeTurnLatency(sample));
      this.turnLatency = this.turnLatency.slice(-50);
      this.save();
    } catch {
      // Latency instrumentation must never affect the Agent turn.
    }
  }

  record(input: DiagnosticEventInput): void {
    try {
      this.events.push({
        source: input.source,
        severity: input.severity,
        message: boundedText(
          redact(String(input.message), this.sensitiveRoots),
          32 * 1024,
        ),
        ...(input.stack
          ? {
              stack: boundedText(
                redact(String(input.stack), this.sensitiveRoots),
                64 * 1024,
              ),
            }
          : {}),
        timestamp: new Date().toISOString(),
      });
      this.events = this.events.slice(-this.maximumEvents);
      this.save();
    } catch {
      // Diagnostics must never cause a second application failure.
    }
  }

  async exportBundle(
    destinationPath: string,
    context: DiagnosticBundleContext,
  ): Promise<void> {
    const payload = {
      format: "artemis-diagnostics",
      version: 2,
      generatedAt: new Date().toISOString(),
      application: {
        version: boundedText(redact(context.appVersion, []), 128),
        platform: boundedText(redact(context.platform, []), 64),
        architecture: boundedText(redact(context.architecture, []), 64),
        locale: boundedText(redact(context.locale, []), 64),
      },
      state: {
        projectCount: Math.max(0, Math.trunc(context.projectCount)),
        threadCount: Math.max(0, Math.trunc(context.threadCount)),
        activeTurnCount: Math.max(0, Math.trunc(context.activeTurnCount)),
        agentConcurrency: structuredClone(context.agentConcurrency),
      },
      events: structuredClone(this.events),
      turnLatency: structuredClone(this.turnLatency),
      privacy:
        "Credentials, authorization material, and recognizable local paths are removed.",
    };
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(
      destinationPath,
      await gzipAsync(Buffer.from(JSON.stringify(payload, undefined, 2))),
      { mode: 0o600 },
    );
  }

  private load(): {
    events: DiagnosticEvent[];
    turnLatency: TurnLatencySample[];
  } {
    try {
      const parsed = JSON.parse(
        readFileSync(this.statePath, "utf8"),
      ) as PersistedDiagnostics;
      if (![1, 2].includes(parsed.version) || !Array.isArray(parsed.events)) {
        return { events: [], turnLatency: [] };
      }
      const events = parsed.events
        .filter(
          (event) =>
            event &&
            typeof event.timestamp === "string" &&
            typeof event.message === "string" &&
            ["main", "renderer", "agent-host"].includes(event.source) &&
            ["info", "warning", "error", "fatal"].includes(event.severity),
        )
        .slice(-this.maximumEvents);
      const turnLatency = Array.isArray(parsed.turnLatency)
        ? parsed.turnLatency
            .filter(
              (sample) =>
                sample &&
                typeof sample.timestamp === "string" &&
                ["completed", "failed"].includes(sample.outcome) &&
                typeof sample.coldThread === "boolean" &&
                sample.stagesMs &&
                typeof sample.stagesMs === "object",
            )
            .map((sample) => this.sanitizeTurnLatency(sample))
            .slice(-50)
        : [];
      return { events, turnLatency };
    } catch {
      return { events: [], turnLatency: [] };
    }
  }

  private sanitizeTurnLatency(sample: TurnLatencySample): TurnLatencySample {
    const stagesMs: TurnLatencySample["stagesMs"] = {};
    for (const name of LATENCY_STAGE_NAMES) {
      const value = metric(sample.stagesMs[name]);
      if (value !== undefined) stagesMs[name] = value;
    }
    const contextTokens = metric(sample.contextTokens);
    const cacheReadTokens = metric(sample.cacheReadTokens);
    return {
      timestamp: Number.isFinite(Date.parse(sample.timestamp))
        ? new Date(sample.timestamp).toISOString()
        : new Date().toISOString(),
      outcome: sample.outcome,
      coldThread: sample.coldThread,
      ...(sample.providerId
        ? {
            providerId: boundedText(
              redact(sample.providerId, this.sensitiveRoots),
              256,
            ),
          }
        : {}),
      ...(sample.modelId
        ? {
            modelId: boundedText(
              redact(sample.modelId, this.sensitiveRoots),
              256,
            ),
          }
        : {}),
      ...(sample.thinkingLevel
        ? {
            thinkingLevel: boundedText(
              redact(sample.thinkingLevel, this.sensitiveRoots),
              32,
            ),
          }
        : {}),
      mode: boundedText(redact(sample.mode, this.sensitiveRoots), 32),
      enabledMcpServers: metric(sample.enabledMcpServers) ?? 0,
      toolCount: metric(sample.toolCount) ?? 0,
      mcpToolCount: metric(sample.mcpToolCount) ?? 0,
      queueDepth: metric(sample.queueDepth) ?? 0,
      eventCount: metric(sample.eventCount) ?? 0,
      ...(contextTokens === undefined ? {} : { contextTokens }),
      ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
      stagesMs,
    };
  }

  private save(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({
        version: 2,
        events: this.events,
        turnLatency: this.turnLatency,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, this.statePath);
  }
}
