import { useState } from "react";

import { artemisThemeManifest } from "@artemis/theme-artemis";
import { ConformanceProbe } from "@artemis/ui/conformance";

import { galleryContract } from "./gallery-contract.js";
import { STRESS_SKIN_ID, stressSkinCss } from "./stress-skin-fixture.mjs";

export type GallerySkin = "default" | "stress";

export function applyGallerySkin(skin: GallerySkin): void {
  document.documentElement.dataset.artemisSkin =
    skin === "default" ? artemisThemeManifest.id : STRESS_SKIN_ID;
  document.documentElement.dataset.artemisTheme = "light";
  document.documentElement.dataset.artemisContrast = "normal";
}

export function installGalleryStressSkinStyles(): void {
  if (document.head.querySelector("style[data-gallery-stress-skin]") !== null) {
    return;
  }
  const style = document.createElement("style");
  style.dataset.galleryStressSkin = "";
  style.textContent = stressSkinCss;
  document.head.append(style);
}

function currentGallerySkin(): GallerySkin {
  return document.documentElement.dataset.artemisSkin === STRESS_SKIN_ID
    ? "stress"
    : "default";
}

export function GalleryApp() {
  const [skin, setSkin] = useState<GallerySkin>(currentGallerySkin);
  const [eventOrder, setEventOrder] = useState<readonly string[]>([]);
  const appendEvent = (entry: string) =>
    setEventOrder((current) => [...current, entry]);

  const switchSkin = () => {
    const nextSkin = skin === "default" ? "stress" : "default";
    if (nextSkin === "stress") installGalleryStressSkinStyles();
    applyGallerySkin(nextSkin);
    setSkin(nextSkin);
  };

  return (
    <main>
      <p className="gallery-eyebrow">CL0B component contract harness</p>
      <h1>Artemis UI Gallery scaffold</h1>
      <p>
        Public package consumption is active for UI contract v
        {galleryContract.uiContractVersion} and skin {galleryContract.skinId}.
      </p>
      <button
        type="button"
        className="gallery-skin-toggle"
        onMouseDown={(event) => event.preventDefault()}
        onClick={switchSkin}
      >
        Use {skin === "default" ? "stress" : "default"} skin
      </button>
      <p aria-live="polite" data-gallery-active-skin={skin}>
        Active harness skin: {skin}
      </p>
      <section
        className="gallery-probe-section"
        aria-labelledby="probe-heading"
      >
        <h2 id="probe-heading">ConformanceProbe</h2>
        <ConformanceProbe
          id="gallery-probe"
          label="Synthetic value"
          description="State must survive a skin switch."
          defaultValue="preserve"
          onValueChange={(value) => appendEvent(`change:${value}`)}
          onCommit={(value) => appendEvent(`commit:${value}`)}
          onEvent={(event) => appendEvent(`event:${event.type}:${event.value}`)}
        />
        <output data-gallery-event-order>{eventOrder.join("|")}</output>
      </section>
    </main>
  );
}
