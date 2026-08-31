import {
  ARTEMIS_THEME_VERSION,
  artemisThemeManifest,
} from "@artemis/theme-artemis";
import { validateSkinManifest } from "@artemis/theme-contract";
import { UI_CONTRACT_VERSION } from "@artemis/ui";

const manifestReport = validateSkinManifest(artemisThemeManifest);
if (!manifestReport.valid) {
  throw new Error("The bundled Artemis theme manifest failed validation");
}

export const galleryContract = Object.freeze({
  uiContractVersion: UI_CONTRACT_VERSION,
  themeVersion: ARTEMIS_THEME_VERSION,
  skinId: artemisThemeManifest.id,
  modes: artemisThemeManifest.modes,
  contrastModes: artemisThemeManifest.capabilities.contrastModes,
});
