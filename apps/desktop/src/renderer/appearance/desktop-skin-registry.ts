import artemisManifest from "@artemis/theme-artemis/manifest.json";
import {
  createDesktopSkinRegistry,
  type DesktopSkinRegistration,
  type DesktopSkinRegistry,
} from "./desktop-skin.js";

const defaultRegistration: DesktopSkinRegistration = {
  manifest: artemisManifest,
  load: async () => undefined,
  ready: () => true,
};
let current = createDesktopSkinRegistry([defaultRegistration]);
export function replaceDesktopSkinCatalog(
  registrations: readonly DesktopSkinRegistration[],
): void {
  current = createDesktopSkinRegistry([defaultRegistration, ...registrations]);
}
export const productionDesktopSkinRegistry: DesktopSkinRegistry = {
  get defaultSkin() {
    return current.defaultSkin;
  },
  get ids() {
    return current.ids;
  },
  get: (id) => current.get(id),
};
