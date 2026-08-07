import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, relative, resolve } from "node:path";

import {
  buildDesktopUserLaunch,
  buildSeatbeltLaunch,
  buildWindowsAppContainerLaunch,
  type SandboxLaunch,
  type SandboxPolicy,
} from "@artemis/platform";
import type { ExtensionRuntimeTool, RunMode } from "@artemis/protocol";

import {
  hashExtensionFile,
  type TrustedExtensionConfig,
} from "./trusted-extension-store.js";

const RESULT_PREFIX = "ARTEMIS_EXTENSION_RESULT:";
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

interface DiscoveredTool {
  name: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface DiscoveryResult {
  tools: DiscoveredTool[];
  unsupported: {
    handlers: number;
    commands: number;
    flags: number;
    shortcuts: number;
  };
}

interface ExecutionResult {
  content: unknown[];
  details?: unknown;
}

export interface TrustedExtensionStatus {
  config: TrustedExtensionConfig;
  state: "disabled" | "ready" | "changed" | "failed";
  tools: ExtensionRuntimeTool[];
  unsupported?: DiscoveryResult["unsupported"];
  error?: string;
}

type WorkerRequest =
  | {
      type: "discover";
      extensionPath: string;
      expectedHash: string;
      workspacePath: string;
    }
  | {
      type: "execute";
      extensionPath: string;
      expectedHash: string;
      workspacePath: string;
      toolName: string;
      arguments: Record<string, unknown>;
    };

export type ExtensionProcessFactory = (
  request: WorkerRequest,
  config: TrustedExtensionConfig,
  mode: RunMode,
  localFullAccess: boolean,
) => Promise<unknown>;

function piToolName(extensionId: string, toolName: string): string {
  const safeExtension = extensionId.replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
  const safeTool = toolName.replaceAll(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 40);
  const digest = createHash("sha256")
    .update(extensionId)
    .update("\0")
    .update(toolName)
    .digest("hex")
    .slice(0, 8);
  return `extension__${safeExtension}__${safeTool || "tool"}_${digest}`;
}

function readableRoot(path: string): string {
  const asarIndex = path.toLowerCase().indexOf(".asar");
  return asarIndex >= 0 ? dirname(path.slice(0, asarIndex + 5)) : dirname(path);
}

function pathIsInside(root: string, candidate: string): boolean {
  const relation = relative(resolve(root), resolve(candidate));
  return (
    relation === "" || (!relation.startsWith("..") && !relation.includes(":"))
  );
}

function formatResult(result: ExecutionResult): {
  output: string;
  isError: boolean;
} {
  const output = result.content
    .map((item) => {
      if (
        item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string"
      ) {
        return item.text;
      }
      return JSON.stringify(item);
    })
    .join("\n");
  if (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES) {
    throw new Error("Extension tool output exceeds 2 MiB");
  }
  return { output, isError: false };
}

export class TrustedExtensionManager {
  private statuses = new Map<string, TrustedExtensionStatus>();

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly windowsHelperPath: string | undefined,
    private readonly workerPath: string,
    private readonly factory: ExtensionProcessFactory = (
      request,
      config,
      mode,
      localFullAccess,
    ) => this.runSandboxed(request, config, mode, localFullAccess),
  ) {}

  async refresh(
    configs: TrustedExtensionConfig[],
    workspacePath?: string,
    localFullAccess = false,
  ): Promise<TrustedExtensionStatus[]> {
    this.statuses.clear();
    for (const config of configs) {
      if (!config.enabled) {
        this.statuses.set(config.id, {
          config: structuredClone(config),
          state: "disabled",
          tools: [],
        });
        continue;
      }
      try {
        if ((await hashExtensionFile(config.path)) !== config.sha256) {
          this.statuses.set(config.id, {
            config: structuredClone(config),
            state: "changed",
            tools: [],
            error: "Extension contents changed; trust it again before loading.",
          });
          continue;
        }
        const cwd = workspacePath ?? dirname(config.path);
        const discovery = (await this.factory(
          {
            type: "discover",
            extensionPath: config.path,
            expectedHash: config.sha256,
            workspacePath: cwd,
          },
          config,
          "review",
          localFullAccess,
        )) as DiscoveryResult;
        const tools = discovery.tools.map((tool) => ({
          extensionId: config.id,
          extensionName: config.name,
          piName: piToolName(config.id, tool.name),
          toolName: tool.name,
          label: tool.label,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
        this.statuses.set(config.id, {
          config: structuredClone(config),
          state: "ready",
          tools,
          unsupported: discovery.unsupported,
        });
      } catch (error) {
        this.statuses.set(config.id, {
          config: structuredClone(config),
          state: "failed",
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return this.status();
  }

  status(): TrustedExtensionStatus[] {
    return [...this.statuses.values()].map((status) => structuredClone(status));
  }

  tools(): ExtensionRuntimeTool[] {
    return this.status()
      .filter((status) => status.state === "ready")
      .flatMap((status) => status.tools);
  }

  async call(
    extensionId: string,
    toolName: string,
    argumentsValue: Record<string, unknown>,
    workspacePath: string,
    mode: RunMode,
    localFullAccess = false,
  ): Promise<{ output: string; isError: boolean }> {
    if (mode !== "execute") {
      throw new Error(
        "Trusted extensions cannot execute in Plan or Review mode",
      );
    }
    const status = this.statuses.get(extensionId);
    if (!status || status.state !== "ready") {
      throw new Error("Trusted extension is not ready");
    }
    if (!status.tools.some((tool) => tool.toolName === toolName)) {
      throw new Error("Trusted extension tool is unavailable");
    }
    if (
      (await hashExtensionFile(status.config.path)) !== status.config.sha256
    ) {
      status.state = "changed";
      status.tools = [];
      status.error =
        "Extension contents changed; trust it again before loading.";
      throw new Error(status.error);
    }
    const result = (await this.factory(
      {
        type: "execute",
        extensionPath: status.config.path,
        expectedHash: status.config.sha256,
        workspacePath,
        toolName,
        arguments: structuredClone(argumentsValue),
      },
      status.config,
      mode,
      localFullAccess,
    )) as ExecutionResult;
    return formatResult(result);
  }

  private runSandboxed(
    request: WorkerRequest,
    config: TrustedExtensionConfig,
    mode: RunMode,
    localFullAccess: boolean,
  ): Promise<unknown> {
    const command = {
      executable: process.execPath,
      args: [
        "--preserve-symlinks",
        "--preserve-symlinks-main",
        this.workerPath,
      ],
      cwd: request.workspacePath,
      env: {
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
    };
    const policy: SandboxPolicy = {
      workspacePath: request.workspacePath,
      mode,
      network: config.allowNetwork && mode === "execute" ? "allow" : "deny",
      readOnlyPaths: [
        readableRoot(this.workerPath),
        dirname(config.path),
      ].filter((path) => !pathIsInside(request.workspacePath, path)),
    };
    const launch: SandboxLaunch = localFullAccess
      ? buildDesktopUserLaunch(command)
      : this.platform === "win32"
        ? buildWindowsAppContainerLaunch(command, policy, {
            helperPath:
              this.windowsHelperPath ??
              (() => {
                throw new Error("Windows sandbox helper is unavailable");
              })(),
            identity: `Artemis.Extension.${randomUUID().replaceAll("-", "")}`,
          })
        : this.platform === "darwin"
          ? buildSeatbeltLaunch(command, policy)
          : (() => {
              throw new Error(
                `Trusted extensions are unsupported on ${this.platform}`,
              );
            })();

    return new Promise((resolvePromise, reject) => {
      const child = spawn(launch.executable, launch.args, {
        cwd: launch.cwd,
        env: {
          ...process.env,
          ...(launch.env ?? {}),
          ARTEMIS_SANDBOX: launch.implementation,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let oversized = false;
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Trusted extension timed out after 60 seconds"));
      }, 60_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES * 2) {
          oversized = true;
          child.kill();
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        if (Buffer.byteLength(stderr, "utf8") > MAX_OUTPUT_BYTES) {
          stderr = stderr.slice(-MAX_OUTPUT_BYTES);
        }
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", () => {
        clearTimeout(timeout);
        if (oversized) {
          reject(new Error("Trusted extension process output exceeds 4 MiB"));
          return;
        }
        const marker = stdout.lastIndexOf(RESULT_PREFIX);
        if (marker < 0) {
          reject(
            new Error(
              stderr.trim() || "Trusted extension process returned no result",
            ),
          );
          return;
        }
        try {
          const line = stdout
            .slice(marker + RESULT_PREFIX.length)
            .split(/\r?\n/u, 1)[0]!;
          const response = JSON.parse(line) as {
            ok: boolean;
            result?: unknown;
            error?: string;
          };
          if (!response.ok) {
            reject(new Error(response.error ?? "Trusted extension failed"));
          } else {
            resolvePromise(response.result);
          }
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Trusted extension result is invalid"),
          );
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
