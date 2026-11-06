import type { ExtensionRuntimeTool } from "@artemis/protocol";
import type { SettingsSnapshot } from "./settings.js";
export interface ExtensionsApi {
  trustExtension(): Promise<SettingsSnapshot | undefined>;
  retrustExtension(extensionId: string): Promise<SettingsSnapshot>;
  setTrustedExtensionEnabled(
    extensionId: string,
    enabled: boolean,
  ): Promise<SettingsSnapshot>;
  setTrustedExtensionNetwork(
    extensionId: string,
    allowNetwork: boolean,
  ): Promise<SettingsSnapshot>;
  removeTrustedExtension(extensionId: string): Promise<SettingsSnapshot>;
}

export interface TrustedExtensionConfig {
  id: string;
  name: string;
  path: string;
  sha256: string;
  enabled: boolean;
  allowNetwork: boolean;
  trustedAt: string;
}

export interface TrustedExtensionStatus {
  config: TrustedExtensionConfig;
  state: "disabled" | "ready" | "changed" | "failed";
  tools: ExtensionRuntimeTool[];
  unsupported?: {
    handlers: number;
    commands: number;
    flags: number;
    shortcuts: number;
  };
  error?: string;
}
