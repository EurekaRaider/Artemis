import type {
  AppearanceState,
  SkinSelection,
  ResolvedSkinPackage,
} from "../appearance.js";

export interface AppearanceApi {
  getAppearanceState(): Promise<AppearanceState>;
  resolveSkin(selection: SkinSelection): Promise<ResolvedSkinPackage>;
  releaseSkinResources(leaseId: string): Promise<void>;
  setSkinSelection(selection: SkinSelection | null): Promise<AppearanceState>;
  onAppearanceStateChanged(
    listener: (state: AppearanceState) => void,
  ): () => void;
}
