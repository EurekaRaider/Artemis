export const THEME_SCHEMA_VERSION = 1 as const;
export const UI_CONTRACT_VERSION = 1 as const;
export const UI_CONTRACT_RANGE = ">=1 <2" as const;
export const SKIN_MANIFEST_FILE_NAME = "manifest.json" as const;
export const SKIN_LIGHT_TOKEN_FILE_NAME = "tokens.light.json" as const;
export const SKIN_DARK_TOKEN_FILE_NAME = "tokens.dark.json" as const;
export const SKIN_CONTRAST_TOKEN_FILE_NAME = "tokens.contrast.json" as const;

export type ThemeMode = "light" | "dark";
export type ContrastMode = "normal" | "high";
export type DensityMode = "comfortable" | "compact";
export type PlatformCapability = "universal" | "macos" | "windows" | "linux";
export type SkinTokenFileName =
  | typeof SKIN_LIGHT_TOKEN_FILE_NAME
  | typeof SKIN_DARK_TOKEN_FILE_NAME
  | typeof SKIN_CONTRAST_TOKEN_FILE_NAME;
export type SkinDataFileName =
  typeof SKIN_MANIFEST_FILE_NAME | SkinTokenFileName;

export type FontStackId = "system-ui" | "system-mono" | "editorial-serif";
export type MotionEasingId =
  "standard" | "entrance" | "exit" | "linear" | "shell";
export type ShadowId = "none" | "soft" | "raised" | "overlay";

export type ThemeTokenValue =
  | { readonly kind: "color"; readonly value: `#${string}` }
  | {
      readonly kind: "length";
      readonly value: number;
      readonly unit: "px";
    }
  | { readonly kind: "fontFamily"; readonly value: FontStackId }
  | { readonly kind: "fontWeight"; readonly value: 400 | 500 | 600 | 700 }
  | {
      readonly kind: "duration";
      readonly value: number;
      readonly unit: "ms";
    }
  | { readonly kind: "easing"; readonly value: MotionEasingId }
  | { readonly kind: "shadow"; readonly value: ShadowId }
  | { readonly kind: "opacity"; readonly value: number };

export type ThemeTokenKind = ThemeTokenValue["kind"];

export interface SemanticTokenDefinition {
  readonly kind: ThemeTokenKind;
  readonly required: boolean;
  readonly cssVariable: `--artemis-${string}`;
  readonly fallback: ThemeTokenValue;
  readonly min?: number;
  readonly max?: number;
  readonly allowedValues?: readonly (string | number)[];
}

export interface SkinCapabilities {
  readonly contrastModes: readonly ContrastMode[];
  readonly densities: readonly DensityMode[];
  readonly platforms: readonly PlatformCapability[];
}

export interface SkinManifest {
  readonly schemaVersion: typeof THEME_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly uiContract: typeof UI_CONTRACT_RANGE;
  readonly modes: readonly ThemeMode[];
  readonly tokens: {
    readonly light: typeof SKIN_LIGHT_TOKEN_FILE_NAME;
    readonly dark: typeof SKIN_DARK_TOKEN_FILE_NAME;
    readonly contrast?: typeof SKIN_CONTRAST_TOKEN_FILE_NAME;
  };
  readonly capabilities: SkinCapabilities;
}

export interface ThemeTokenMode {
  readonly theme: ThemeMode;
  readonly contrast: ContrastMode;
  readonly density: DensityMode;
  readonly platform: PlatformCapability;
  readonly tokens: Readonly<Record<string, ThemeTokenValue>>;
}

export interface ThemeTokenDocument {
  readonly schemaVersion: typeof THEME_SCHEMA_VERSION;
  readonly skinId: string;
  readonly modes: readonly ThemeTokenMode[];
}

export type ConformanceIssueCode =
  | "duplicate_mode"
  | "incompatible_ui_contract"
  | "invalid_field"
  | "invalid_hash"
  | "invalid_type"
  | "invalid_value"
  | "manifest_mismatch"
  | "missing_document"
  | "missing_integrity_file"
  | "missing_mode"
  | "missing_required_token"
  | "unknown_document"
  | "unknown_field"
  | "unknown_integrity_file"
  | "unknown_token"
  | "unsupported_capability";

export interface ConformanceIssue {
  readonly code: ConformanceIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface ConformanceReport<T> {
  readonly valid: boolean;
  readonly issues: readonly ConformanceIssue[];
  readonly value?: T;
}

export interface ResolvedThemeMode extends Omit<ThemeTokenMode, "tokens"> {
  readonly tokens: Readonly<Record<string, ThemeTokenValue>>;
  readonly fallbackTokens: readonly string[];
}

export interface ValidatedSkinPackage {
  readonly manifest: SkinManifest;
  readonly documents: Readonly<Record<string, ThemeTokenDocument>>;
  readonly modes: readonly ResolvedThemeMode[];
  readonly fallbackTokens: readonly string[];
}

export interface SkinPackageInput {
  readonly manifest: unknown;
  readonly tokenDocuments: Readonly<Record<string, unknown>>;
}

export interface SkinIntegrityFiles {
  readonly "manifest.json": string;
  readonly "tokens.light.json": string;
  readonly "tokens.dark.json": string;
  readonly "tokens.contrast.json"?: string;
}

export interface SkinIntegrity {
  readonly algorithm: "sha256";
  readonly files: SkinIntegrityFiles;
}
