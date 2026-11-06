import type { McpRuntimeTool, RunMode } from "@artemis/protocol";
import { type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpServerConfig } from "../../shared/api.js";

export interface McpTool {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?:
    | {
        readOnlyHint?: boolean | undefined;
        destructiveHint?: boolean | undefined;
      }
    | undefined;
}

export interface McpCallResult {
  structuredContent?: unknown;
  content?: unknown[];
  isError?: boolean;
}

export interface McpConnection {
  onClose?(listener: () => void): void;
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(
    input: {
      name: string;
      arguments: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface McpConnectionAuthentication {
  fetch?: typeof fetch;
  bearerToken?: string;
  headers?: Record<string, string>;
  oauthProvider?: OAuthClientProvider;
  authorizationCode?: Promise<string>;
  stdioEnv?: Record<string, string>;
}

export interface McpExecutionScope {
  workspacePath: string;
  mode: Extract<RunMode, "work" | "codemode">;
  /** Host-approved, single-call access; never changes the server configuration. */
  sandboxEscalation?: boolean;
}

export interface McpConnectOptions {
  startupTimeoutMs?: number;
}

export interface McpConnectionFactoryOptions extends McpConnectOptions {
  startupSignal?: AbortSignal;
}

export type McpConnectionFactory = (
  config: McpServerConfig,
  authentication: McpConnectionAuthentication | undefined,
  scope?: McpExecutionScope,
  options?: McpConnectionFactoryOptions,
) => Promise<McpConnection>;

export interface ActiveConnection {
  config: McpServerConfig;
  authentication?: McpConnectionAuthentication;
  client: McpConnection;
  tools: McpRuntimeTool[];
  releaseAfterCall?: () => Promise<void>;
}

export interface ResolvedWindowsStdioCommand {
  executable: string;
  args: string[];
}

export interface ResolvedWindowsStdioCommandDetails extends ResolvedWindowsStdioCommand {
  shimPath?: string;
}

export type ResolveWindowsCommandShim = (
  shimPath: string,
  args: string[],
) => ResolvedWindowsStdioCommand | undefined;
