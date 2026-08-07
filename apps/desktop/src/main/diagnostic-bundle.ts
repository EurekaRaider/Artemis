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
  version: 1;
  events: DiagnosticEvent[];
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

export class DiagnosticBundleService {
  private events: DiagnosticEvent[];

  constructor(
    private readonly statePath: string,
    private readonly sensitiveRoots: readonly string[],
    private readonly maximumEvents = 200,
  ) {
    this.events = this.load();
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
      version: 1,
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

  private load(): DiagnosticEvent[] {
    try {
      const parsed = JSON.parse(
        readFileSync(this.statePath, "utf8"),
      ) as PersistedDiagnostics;
      if (parsed.version !== 1 || !Array.isArray(parsed.events)) return [];
      return parsed.events
        .filter(
          (event) =>
            event &&
            typeof event.timestamp === "string" &&
            typeof event.message === "string" &&
            ["main", "renderer", "agent-host"].includes(event.source) &&
            ["info", "warning", "error", "fatal"].includes(event.severity),
        )
        .slice(-this.maximumEvents);
    } catch {
      return [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ version: 1, events: this.events })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, this.statePath);
  }
}
