import type {
  SkinManifest,
  SkinIntegrity,
  SkinPackageInput,
  ThemeTokenDocument,
} from "@artemis/theme-contract";

export const STRESS_SKIN_ID: "com.artemis.synthetic-stress";
export const stressSkinManifest: SkinManifest;
export const stressLightTokens: ThemeTokenDocument;
export const stressDarkTokens: ThemeTokenDocument;
export const stressContrastTokens: ThemeTokenDocument;
export const stressSkinTokenDocuments: Readonly<
  Record<string, ThemeTokenDocument>
>;
export const stressSkinPackage: SkinPackageInput;
export const stressSkinDataFiles: Readonly<Record<string, unknown>>;
export const stressSkinIntegrity: SkinIntegrity;
export const stressSkinPackageFiles: Readonly<Record<string, unknown>>;
export const stressSkinCss: string;
