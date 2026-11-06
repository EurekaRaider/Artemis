export interface DesignApi {
  designCapabilityStatus(): Promise<
    import("@artemis/protocol").CapabilityPackStatus
  >;
  designCapabilityAvailability(): Promise<{ available: boolean }>;
  onDesignCapabilityAvailability(
    listener: (event: { available: boolean }) => void,
  ): () => void;
  checkDesignCapabilityUpdates(): Promise<void>;
  installDesignCapability(): Promise<void>;
  importDesignCapability(input?: { path: string }): Promise<void>;
  cancelDesignCapability(): Promise<void>;
  activateDesignCapability(version: string): Promise<void>;
  deactivateDesignCapability(): Promise<void>;
  uninstallDesignCapability(version?: string): Promise<void>;
}
