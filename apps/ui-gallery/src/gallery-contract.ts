import {
  ARTEMIS_THEME_VERSION,
  artemisThemeManifest,
} from "@artemis/theme-artemis";
import { validateSkinManifest } from "@artemis/theme-contract";
import { UI_CONTRACT_VERSION } from "@artemis/ui";
import { STRESS_SKIN_ID, stressSkinPackage } from "./stress-skin-fixture.mjs";

const manifestReport = validateSkinManifest(artemisThemeManifest);
if (!manifestReport.valid) {
  throw new Error("The bundled Artemis theme manifest failed validation");
}
const stressReport = validateSkinManifest(stressSkinPackage.manifest);
if (!stressReport.valid) {
  throw new Error("The synthetic stress manifest failed validation");
}

export const galleryContract = Object.freeze({
  uiContractVersion: UI_CONTRACT_VERSION,
  themeVersion: ARTEMIS_THEME_VERSION,
  skinId: artemisThemeManifest.id,
  modes: artemisThemeManifest.modes,
  contrastModes: artemisThemeManifest.capabilities.contrastModes,
  stressSkinId: STRESS_SKIN_ID,
});
