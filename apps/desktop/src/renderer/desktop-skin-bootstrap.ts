import {
  DesktopSkinHost,
  completeDesktopSkinTokenSnapshot,
  type DesktopThemePreference,
} from "./desktop-skin.js";
import { productionDesktopSkinRegistry } from "./desktop-skin-registry.js";

export const desktopSkinHost = new DesktopSkinHost({
  root: document.documentElement,
  registry: productionDesktopSkinRegistry,
  matchMedia: window.matchMedia.bind(window),
});

let resolveReady: (() => void) | undefined;
let rejectReady: ((reason: unknown) => void) | undefined;
export const desktopSkinReady = new Promise<void>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

export async function bootstrapDesktopSkin(
  theme: DesktopThemePreference = "system",
): Promise<void> {
  try {
    await desktopSkinHost.bootstrap(theme);
    const snapshot = completeDesktopSkinTokenSnapshot(
      getComputedStyle(document.documentElement),
    );
    if (snapshot === undefined) {
      throw new Error(
        "The default Desktop skin did not produce all semantic tokens.",
      );
    }
    resolveReady?.();
  } catch (error) {
    rejectReady?.(error);
    throw error;
  } finally {
    resolveReady = undefined;
    rejectReady = undefined;
  }
}
