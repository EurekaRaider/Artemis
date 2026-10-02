import type { AppTheme } from "@artemis/protocol";
import type {
  AnySkinManifest,
  ValidatedVisualSkinPackage,
} from "@artemis/theme-contract";

export interface SkinSelection {
  readonly pluginId: string;
  readonly skinId: string;
}
export interface SkinSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly schemaVersion: 1 | 2;
}
export interface AppearanceSkin extends SkinSummary {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly contentHash: string;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly manifest?: AnySkinManifest;
  readonly reason?: string;
}
export interface AppearanceState {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly theme: AppTheme;
  readonly selection: SkinSelection | null;
  readonly catalog: readonly AppearanceSkin[];
  readonly mediaPaused: boolean;
}
export interface ResolvedSkinPackage {
  readonly revision: number;
  readonly selection: SkinSelection;
  readonly contentHash: string;
  readonly leaseId: string;
  readonly data: ValidatedVisualSkinPackage;
  readonly assets: Readonly<
    Record<
      string,
      { readonly url: string; readonly hash: string; readonly mime: string }
    >
  >;
}
export function parseSkinSelection(value: unknown): SkinSelection | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid skin selection.");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !["pluginId", "skinId"].includes(k)) ||
    typeof v.pluginId !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(v.pluginId) ||
    typeof v.skinId !== "string" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(
      v.skinId,
    ) ||
    v.skinId.length > 128
  )
    throw new Error("Invalid skin selection.");
  return { pluginId: v.pluginId, skinId: v.skinId };
}
