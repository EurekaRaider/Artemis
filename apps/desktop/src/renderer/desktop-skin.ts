import {
  SEMANTIC_TOKEN_REGISTRY,
  validateSkinManifest,
  type ContrastMode,
  type PlatformCapability,
  type SkinManifest,
  type ThemeMode,
} from "@artemis/theme-contract";

export const DEFAULT_DESKTOP_SKIN_ID = "com.artemis.default" as const;

export type DesktopThemePreference = "system" | ThemeMode;
export type DesktopContrastPreference = "system" | ContrastMode;

export interface DesktopSkinRegistration {
  readonly manifest: unknown;
  readonly load: () => Promise<void>;
  readonly ready: (mode: DesktopSkinMode) => boolean | Promise<boolean>;
  readonly available?: () => boolean | Promise<boolean>;
}

export interface DesktopSkinMode {
  readonly theme: ThemeMode;
  readonly contrast: ContrastMode;
  readonly platform: PlatformCapability;
}

export interface DesktopSkinRegistry {
  readonly defaultSkin: ValidatedDesktopSkinRegistration;
  readonly ids: readonly string[];
  get(id: string): ValidatedDesktopSkinRegistration | undefined;
}

export interface ValidatedDesktopSkinRegistration extends Omit<
  DesktopSkinRegistration,
  "manifest"
> {
  readonly manifest: SkinManifest;
}

export type DesktopSkinFallbackReason =
  "unknown" | "unavailable" | "unsupported" | "load-failed";

export type DesktopSkinTransitionResult =
  | {
      readonly status: "applied";
      readonly requestedSkinId: string;
      readonly activeSkinId: string;
    }
  | {
      readonly status: "fallback";
      readonly requestedSkinId: string;
      readonly activeSkinId: string;
      readonly reason: DesktopSkinFallbackReason;
    }
  | {
      readonly status: "fatal" | "superseded";
      readonly requestedSkinId: string;
      readonly activeSkinId: string | undefined;
      readonly error?: Error;
    };

export interface DesktopSkinRoot {
  readonly dataset: DOMStringMap;
}

export interface DesktopSkinHostOptions {
  readonly root: DesktopSkinRoot;
  readonly registry: DesktopSkinRegistry;
  readonly matchMedia: (query: string) => MediaQueryList;
  readonly platform?: PlatformCapability;
}

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";
const HIGH_CONTRAST_QUERY = "(prefers-contrast: more)";
const FORCED_COLORS_QUERY = "(forced-colors: active)";
const SKIN_ID_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;

class DesktopSkinPreparationError extends Error {
  constructor(
    readonly reason: Exclude<DesktopSkinFallbackReason, "unknown">,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DesktopSkinPreparationError";
  }
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function validatedRegistration(
  registration: DesktopSkinRegistration,
  index: number,
): ValidatedDesktopSkinRegistration {
  if (
    registration === null ||
    typeof registration !== "object" ||
    typeof registration.load !== "function" ||
    typeof registration.ready !== "function" ||
    (registration.available !== undefined &&
      typeof registration.available !== "function")
  ) {
    throw new Error(`Desktop skin registration ${index} is malformed.`);
  }
  const report = validateSkinManifest(registration.manifest);
  if (!report.valid || report.value === undefined) {
    throw new Error(
      `Desktop skin registration ${index} has an invalid manifest: ${report.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return Object.freeze({
    manifest: report.value,
    load: registration.load,
    ready: registration.ready,
    ...(registration.available === undefined
      ? {}
      : { available: registration.available }),
  });
}

export function createDesktopSkinRegistry(
  registrations: readonly DesktopSkinRegistration[],
): DesktopSkinRegistry {
  if (!Array.isArray(registrations) || registrations.length === 0) {
    throw new Error(
      "Desktop skin registry requires at least one registration.",
    );
  }
  const entries = new Map<string, ValidatedDesktopSkinRegistration>();
  registrations.forEach((registration, index) => {
    const validated = validatedRegistration(registration, index);
    const id = validated.manifest.id;
    if (entries.has(id)) {
      throw new Error(`Duplicate desktop skin registration: ${id}`);
    }
    entries.set(id, validated);
  });
  const defaultSkin = entries.get(DEFAULT_DESKTOP_SKIN_ID);
  if (defaultSkin === undefined) {
    throw new Error(
      `Desktop skin registry is missing ${DEFAULT_DESKTOP_SKIN_ID}.`,
    );
  }
  const ids = Object.freeze([...entries.keys()]);
  return Object.freeze({
    defaultSkin,
    ids,
    get: (id: string) => entries.get(id),
  });
}

function resolvedTheme(
  theme: DesktopThemePreference,
  systemDark: boolean,
): ThemeMode {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

function resolvedContrast(
  contrast: DesktopContrastPreference,
  systemHighContrast: boolean,
): ContrastMode {
  return contrast === "system"
    ? systemHighContrast
      ? "high"
      : "normal"
    : contrast;
}

function supportsMode(
  registration: ValidatedDesktopSkinRegistration,
  mode: DesktopSkinMode,
): boolean {
  const { manifest } = registration;
  return (
    manifest.modes.includes(mode.theme) &&
    manifest.capabilities.contrastModes.includes(mode.contrast) &&
    manifest.capabilities.densities.includes("comfortable") &&
    (manifest.capabilities.platforms.includes("universal") ||
      manifest.capabilities.platforms.includes(mode.platform))
  );
}

async function prepareRegistration(
  registration: ValidatedDesktopSkinRegistration,
  mode: DesktopSkinMode,
): Promise<void> {
  if (!supportsMode(registration, mode)) {
    throw new DesktopSkinPreparationError(
      "unsupported",
      `Desktop skin ${registration.manifest.id} does not support ${mode.theme}/${mode.contrast}/${mode.platform}.`,
    );
  }
  if (registration.available !== undefined) {
    let available: boolean;
    try {
      available = await registration.available();
    } catch (error) {
      throw new DesktopSkinPreparationError(
        "unavailable",
        `Desktop skin ${registration.manifest.id} availability check failed.`,
        { cause: error },
      );
    }
    if (!available) {
      throw new DesktopSkinPreparationError(
        "unavailable",
        `Desktop skin ${registration.manifest.id} is unavailable.`,
      );
    }
  }
  try {
    await registration.load();
  } catch (error) {
    throw new DesktopSkinPreparationError(
      "load-failed",
      `Desktop skin ${registration.manifest.id} failed to load.`,
      { cause: error },
    );
  }
  let ready: boolean;
  try {
    ready = await registration.ready(mode);
  } catch (error) {
    throw new DesktopSkinPreparationError(
      "load-failed",
      `Desktop skin ${registration.manifest.id} readiness check failed.`,
      { cause: error },
    );
  }
  if (!ready) {
    throw new DesktopSkinPreparationError(
      "load-failed",
      `Desktop skin ${registration.manifest.id} is not ready.`,
    );
  }
}

function validRequestedSkinId(value: unknown): value is string {
  return typeof value === "string" && SKIN_ID_PATTERN.test(value);
}

export class DesktopSkinHost {
  readonly #root: DesktopSkinRoot;
  readonly #registry: DesktopSkinRegistry;
  readonly #darkMedia: MediaQueryList;
  readonly #highContrastMedia: MediaQueryList;
  readonly #forcedColorsMedia: MediaQueryList;
  readonly #platform: PlatformCapability;
  #generation = 0;
  #themePreference: DesktopThemePreference = "system";
  #contrastPreference: DesktopContrastPreference = "system";
  #activeSkinId: string | undefined;
  #destroyed = false;

  readonly #handleSystemThemeChange = () => {
    if (
      this.#activeSkinId !== undefined &&
      !this.#destroyed &&
      this.#themePreference === "system"
    ) {
      void this.#transition(this.#activeSkinId);
    }
  };
  readonly #handleSystemContrastChange = () => {
    if (
      this.#activeSkinId !== undefined &&
      !this.#destroyed &&
      this.#contrastPreference === "system"
    ) {
      void this.#transition(this.#activeSkinId);
    }
  };

  constructor(options: DesktopSkinHostOptions) {
    this.#root = options.root;
    this.#registry = options.registry;
    this.#darkMedia = options.matchMedia(DARK_MODE_QUERY);
    this.#highContrastMedia = options.matchMedia(HIGH_CONTRAST_QUERY);
    this.#forcedColorsMedia = options.matchMedia(FORCED_COLORS_QUERY);
    this.#platform = options.platform ?? "universal";
    this.#darkMedia.addEventListener("change", this.#handleSystemThemeChange);
    for (const media of this.#systemContrastMedia()) {
      media.addEventListener("change", this.#handleSystemContrastChange);
    }
  }

  get activeSkinId(): string | undefined {
    return this.#activeSkinId;
  }

  get themePreference(): DesktopThemePreference {
    return this.#themePreference;
  }

  get contrastPreference(): DesktopContrastPreference {
    return this.#contrastPreference;
  }

  async bootstrap(
    theme: DesktopThemePreference = "system",
    contrast: DesktopContrastPreference = "system",
  ): Promise<void> {
    this.#themePreference = theme;
    this.#contrastPreference = contrast;
    const generation = ++this.#generation;
    const mode = this.#mode();
    await prepareRegistration(this.#registry.defaultSkin, mode);
    if (generation !== this.#generation || this.#destroyed) {
      throw new Error("Desktop skin bootstrap was superseded.");
    }
    this.#apply(this.#registry.defaultSkin.manifest.id, mode);
  }

  async setTheme(
    theme: DesktopThemePreference,
  ): Promise<DesktopSkinTransitionResult> {
    this.#themePreference = theme;
    return this.#transition(this.#activeSkinId ?? DEFAULT_DESKTOP_SKIN_ID);
  }

  async setContrast(
    contrast: DesktopContrastPreference,
  ): Promise<DesktopSkinTransitionResult> {
    this.#contrastPreference = contrast;
    return this.#transition(this.#activeSkinId ?? DEFAULT_DESKTOP_SKIN_ID);
  }

  async selectSkin(
    requestedSkinId: unknown,
  ): Promise<DesktopSkinTransitionResult> {
    return this.#transition(requestedSkinId);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#generation += 1;
    this.#darkMedia.removeEventListener(
      "change",
      this.#handleSystemThemeChange,
    );
    for (const media of this.#systemContrastMedia()) {
      media.removeEventListener("change", this.#handleSystemContrastChange);
    }
  }

  #systemContrastMedia(): readonly MediaQueryList[] {
    return [this.#highContrastMedia, this.#forcedColorsMedia];
  }

  #mode(): DesktopSkinMode {
    return {
      theme: resolvedTheme(this.#themePreference, this.#darkMedia.matches),
      contrast: resolvedContrast(
        this.#contrastPreference,
        this.#highContrastMedia.matches || this.#forcedColorsMedia.matches,
      ),
      platform: this.#platform,
    };
  }

  async #transition(
    requestedSkinId: unknown,
  ): Promise<DesktopSkinTransitionResult> {
    const generation = ++this.#generation;
    const requested = validRequestedSkinId(requestedSkinId)
      ? requestedSkinId
      : String(requestedSkinId ?? "");
    const selected = validRequestedSkinId(requestedSkinId)
      ? this.#registry.get(requestedSkinId)
      : undefined;
    const mode = this.#mode();
    let fallbackReason: DesktopSkinFallbackReason = "unknown";
    if (selected !== undefined) {
      try {
        await prepareRegistration(selected, mode);
        if (generation !== this.#generation || this.#destroyed) {
          return {
            status: "superseded",
            requestedSkinId: requested,
            activeSkinId: this.#activeSkinId,
          };
        }
        this.#apply(selected.manifest.id, mode);
        return {
          status: "applied",
          requestedSkinId: requested,
          activeSkinId: selected.manifest.id,
        };
      } catch (error) {
        if (selected === this.#registry.defaultSkin) {
          return {
            status: "fatal",
            requestedSkinId: requested,
            activeSkinId: this.#activeSkinId,
            error: errorFrom(error),
          };
        }
        fallbackReason =
          error instanceof DesktopSkinPreparationError
            ? error.reason
            : "load-failed";
        // A selected skin is all-or-nothing. Fall through to the complete
        // built-in skin without applying any selected attributes or tokens.
      }
    }

    try {
      await prepareRegistration(this.#registry.defaultSkin, mode);
      if (generation !== this.#generation || this.#destroyed) {
        return {
          status: "superseded",
          requestedSkinId: requested,
          activeSkinId: this.#activeSkinId,
        };
      }
      this.#apply(this.#registry.defaultSkin.manifest.id, mode);
      return {
        status: "fallback",
        requestedSkinId: requested,
        activeSkinId: this.#registry.defaultSkin.manifest.id,
        reason: fallbackReason,
      };
    } catch (error) {
      return {
        status: "fatal",
        requestedSkinId: requested,
        activeSkinId: this.#activeSkinId,
        error: errorFrom(error),
      };
    }
  }

  #apply(skinId: string, mode: DesktopSkinMode): void {
    this.#root.dataset.artemisSkin = skinId;
    this.#root.dataset.artemisTheme = mode.theme;
    this.#root.dataset.artemisContrast = mode.contrast;
    if (this.#themePreference === "system") {
      delete this.#root.dataset.theme;
    } else {
      this.#root.dataset.theme = this.#themePreference;
    }
    this.#activeSkinId = skinId;
  }
}

export function completeDesktopSkinTokenSnapshot(
  style: Pick<CSSStyleDeclaration, "getPropertyValue">,
): Readonly<Record<string, string>> | undefined {
  const entries: Array<[string, string]> = Object.entries(
    SEMANTIC_TOKEN_REGISTRY,
  ).map(([name, definition]) => [
    name,
    style.getPropertyValue(definition.cssVariable).trim(),
  ]);
  if (entries.some(([, value]) => value.length === 0)) return undefined;
  return Object.freeze(Object.fromEntries(entries));
}
