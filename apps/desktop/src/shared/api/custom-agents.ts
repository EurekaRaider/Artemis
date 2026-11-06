import type {
  CustomAgentDefinition,
  CustomAgentModelPolicy,
  CustomAgentThinkingPolicy,
  CustomAgentToolPolicy,
  RunMode,
} from "@artemis/protocol";
import type { SettingsSnapshot } from "./settings.js";
export interface CustomAgentsApi {
  customAgentsGet(id: string): Promise<CustomAgentDefinition | undefined>;
  customAgentsCreate(input: SaveCustomAgentInput): Promise<SettingsSnapshot>;
  customAgentsUpdate(
    id: string,
    expectedRevision: number,
    input: SaveCustomAgentInput,
  ): Promise<SettingsSnapshot>;
  customAgentsDelete(id: string): Promise<SettingsSnapshot>;
  customAgentsPreviewCapabilities(
    input: Pick<SaveCustomAgentInput, "toolPolicy">,
    mode: RunMode,
  ): Promise<CustomAgentCapabilityPreview>;
}

/**
 * Custom sub-agent metadata safe for renderers (D#152): never carries the
 * dedicated instructions body. The settings editor fetches full
 * definitions through a dedicated endpoint instead.
 */
export interface CustomAgentSummary {
  id: string;
  revision: number;
  name: string;
  description: string;
  color: string;
  enabled: boolean;
  scope: "all" | "selected";
  projectIds: string[];
  modelPolicy: CustomAgentModelPolicy;
  thinkingPolicy: CustomAgentThinkingPolicy;
  toolPolicy: CustomAgentToolPolicy;
  allowAutomaticInvocation: boolean;
  triggers: string[];
  createdAt: number;
  updatedAt: number;
}

/** Create/update payload for a custom sub-agent definition. */
export interface SaveCustomAgentInput {
  name: string;
  description: string;
  color: string;
  enabled: boolean;
  instructions: string;
  scope: "all" | "selected";
  projectIds: string[];
  modelPolicy: CustomAgentModelPolicy;
  thinkingPolicy: CustomAgentThinkingPolicy;
  toolPolicy: CustomAgentToolPolicy;
  allowAutomaticInvocation: boolean;
  triggers: string[];
}

/** Effective-capability preview for the settings form (project/mode aware). */
export interface CustomAgentCapabilityPreview {
  mode: RunMode;
  capabilities: string[];
}
