import type { McpServerConfig } from "../../shared/api.js";

export const COMPUTER_USE_CONFIG_URL =
  "http://127.0.0.1:1/artemis/computer-use";

export function isMcpServerSupported(
  config: McpServerConfig,
  platform: NodeJS.Platform,
): boolean {
  return (
    platform === "darwin" ||
    platform === "win32" ||
    config.transport !== "streamable-http" ||
    config.url !== COMPUTER_USE_CONFIG_URL
  );
}
