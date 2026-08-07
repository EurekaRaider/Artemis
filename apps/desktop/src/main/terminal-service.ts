import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";

import { type SandboxCommand } from "@artemis/platform";
import type { IPty } from "node-pty";

export interface TerminalDescriptor {
  terminalId: string;
  shell: string;
  sandboxImplementation: string;
}

export interface TerminalExit {
  terminalId: string;
  exitCode: number;
  signal?: number;
}

export interface TerminalSpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export interface PtyProcess {
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
}

export type PtyFactory = (
  executable: string,
  args: string[],
  options: TerminalSpawnOptions,
) => PtyProcess;

export type WindowsExecutableResolver = (executable: string) => string;

export interface OpenTerminalInput {
  threadId: string;
  workspacePath: string;
  shell: string;
  cols: number;
  rows: number;
}

interface TerminalSession {
  id: string;
  threadId: string;
  pty: PtyProcess;
  subscriptions: Array<{ dispose(): void }>;
}

export interface TerminalServiceEvents {
  onData(terminalId: string, data: string): void;
  onExit(event: TerminalExit): void;
}

interface NodePtyModule {
  spawn(
    executable: string,
    args: string[],
    options: TerminalSpawnOptions,
  ): IPty;
}

const require = createRequire(import.meta.url);
let configuredNodePty: NodePtyModule | undefined;

function loadNodePty(moduleRoot?: string): NodePtyModule {
  const candidate = require(moduleRoot ?? "node-pty") as Partial<NodePtyModule>;
  if (typeof candidate.spawn !== "function") {
    throw new Error("The node-pty runtime does not export spawn().");
  }
  return candidate as NodePtyModule;
}

export function configureNodePtyRuntime(moduleRoot?: string): void {
  configuredNodePty = loadNodePty(moduleRoot);
}

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function defaultPtyFactory(
  executable: string,
  args: string[],
  options: TerminalSpawnOptions,
): IPty {
  configuredNodePty ??= loadNodePty();
  return configuredNodePty.spawn(executable, args, options);
}

function defaultWindowsExecutableResolver(executable: string): string {
  const candidate = isAbsolute(executable)
    ? executable
    : execFileSync("where.exe", [executable], {
        encoding: "utf8",
        windowsHide: true,
      })
        .split(/\r?\n/u)
        .find((path) => path.trim())
        ?.trim();
  if (!candidate) {
    throw new Error(`Windows terminal executable was not found: ${executable}`);
  }
  const canonicalPath = realpathSync.native(candidate);
  if (!statSync(canonicalPath).isFile()) {
    throw new Error(`Windows terminal executable is not a file: ${executable}`);
  }
  return canonicalPath;
}

const windowsTerminalBootstrap = [
  "if ((Get-Location).Path -ne $env:ARTEMIS_WORKSPACE) { Set-Location -LiteralPath $env:ARTEMIS_WORKSPACE -ErrorAction Stop }",
  "Set-PSReadLineOption -HistorySaveStyle SaveNothing",
].join("; ");

function clampDimension(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly terminalByThread = new Map<string, string>();

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly events: TerminalServiceEvents,
    private readonly createPty: PtyFactory = defaultPtyFactory,
    private readonly resolveWindowsExecutable: WindowsExecutableResolver = defaultWindowsExecutableResolver,
  ) {}

  open(input: OpenTerminalInput): TerminalDescriptor {
    const existingId = this.terminalByThread.get(input.threadId);
    if (existingId) {
      this.close(existingId);
    }

    const terminalId = randomUUID();
    const command: SandboxCommand = {
      executable:
        this.platform === "win32"
          ? this.resolveWindowsExecutable(input.shell)
          : input.shell,
      args:
        this.platform === "win32"
          ? [
              "-NoLogo",
              "-NoProfile",
              "-NoExit",
              "-EncodedCommand",
              Buffer.from(windowsTerminalBootstrap, "utf16le").toString(
                "base64",
              ),
            ]
          : ["-l"],
      cwd: input.workspacePath,
      ...(this.platform === "win32"
        ? {
            env: {
              ARTEMIS_WORKSPACE: input.workspacePath,
            },
          }
        : {}),
    };
    if (this.platform !== "win32" && this.platform !== "darwin") {
      throw new Error(`PTY is unsupported on ${this.platform}`);
    }

    const pty = this.createPty(command.executable, command.args, {
      name: "xterm-256color",
      cols: clampDimension(input.cols, 20, 500),
      rows: clampDimension(input.rows, 5, 200),
      cwd: command.cwd,
      env: {
        ...processEnvironment(),
        ...(command.env ?? {}),
        TERM: "xterm-256color",
      },
    });

    const session: TerminalSession = {
      id: terminalId,
      threadId: input.threadId,
      pty,
      subscriptions: [],
    };
    session.subscriptions.push(
      pty.onData((data) => this.events.onData(terminalId, data)),
      pty.onExit((event) => {
        this.removeSession(session);
        this.events.onExit({
          terminalId,
          exitCode: event.exitCode,
          ...(event.signal === undefined ? {} : { signal: event.signal }),
        });
      }),
    );
    this.sessions.set(terminalId, session);
    this.terminalByThread.set(input.threadId, terminalId);

    return {
      terminalId,
      shell: input.shell,
      sandboxImplementation: "desktop-user",
    };
  }

  write(terminalId: string, data: string): void {
    if (Buffer.byteLength(data, "utf8") > 64 * 1024) {
      throw new Error("Terminal input exceeds 64 KiB");
    }
    this.get(terminalId).pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.get(terminalId).pty.resize(
      clampDimension(cols, 20, 500),
      clampDimension(rows, 5, 200),
    );
  }

  close(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) {
      return;
    }
    this.removeSession(session);
    session.pty.kill();
  }

  dispose(): void {
    for (const terminalId of [...this.sessions.keys()]) {
      this.close(terminalId);
    }
  }

  private get(terminalId: string): TerminalSession {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new Error("Terminal session is no longer active");
    }
    return session;
  }

  private removeSession(session: TerminalSession): void {
    if (this.sessions.get(session.id) !== session) {
      return;
    }
    this.sessions.delete(session.id);
    if (this.terminalByThread.get(session.threadId) === session.id) {
      this.terminalByThread.delete(session.threadId);
    }
    for (const subscription of session.subscriptions) {
      subscription.dispose();
    }
  }
}
