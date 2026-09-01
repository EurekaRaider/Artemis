import artemisManifest from "@artemis/theme-artemis/manifest.json";

import {
  createDesktopSkinRegistry,
  type DesktopSkinRegistration,
} from "./desktop-skin.js";

const productionRegistrations = Object.freeze([
  {
    manifest: artemisManifest,
    load: async () => undefined,
    ready: () => true,
  },
] satisfies readonly DesktopSkinRegistration[]);

export const productionDesktopSkinRegistry = createDesktopSkinRegistry(
  productionRegistrations,
);
