import type { AppLocale } from "@artemis/protocol";
import type {
  InstalledSkill,
  McpCatalogInstallOption,
  McpCatalogItem,
  McpServerStatus,
  SettingsSnapshot,
} from "../../shared/api.js";
import { type ResourceIconKind } from "./resource-icons.js";

export interface ResourceCenterProps {
  headerActionTarget?: HTMLElement | null | undefined;
  onReviewHooks?(pluginId: string, trigger: HTMLButtonElement): void;
  locale: AppLocale;
  settings?: SettingsSnapshot;
  onConfirm(
    message: string,
    tone?: "default" | "danger",
    options?: { title?: string; acceptLabel?: string },
  ): Promise<boolean>;
  onSettingsChange(settings: SettingsSnapshot): void;
}

export interface McpInstallDraft {
  item: McpCatalogItem;
  option: McpCatalogInstallOption;
  values: Record<string, string>;
}

export type ManagementTab = "plugins" | "mcp" | "skills";

export type CatalogSearchTab = Extract<ManagementTab, "mcp" | "skills">;

export type CatalogSearchPhase = "idle" | "searching" | "complete";

export type ResourceKind = ResourceIconKind;

export type ResourceRemovalDraft =
  | { kind: "mcp"; server: McpServerStatus }
  | { kind: "skill"; skill: InstalledSkill };
