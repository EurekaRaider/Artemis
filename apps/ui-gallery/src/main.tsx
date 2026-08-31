import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@artemis/theme-artemis/theme.css";
import "@artemis/ui/styles.css";
import "./gallery.css";
import { galleryContract } from "./gallery-contract.js";

const rootElement = document.documentElement;
rootElement.dataset.artemisSkin = galleryContract.skinId;
rootElement.dataset.artemisTheme = "light";
rootElement.dataset.artemisContrast = "normal";

const mount = document.querySelector<HTMLDivElement>("#root");
if (mount === null) throw new Error("Missing UI Gallery root");

createRoot(mount).render(
  <StrictMode>
    <main>
      <p className="gallery-eyebrow">CL0A package boundary</p>
      <h1>Artemis UI Gallery scaffold</h1>
      <p>
        Public package consumption is active for UI contract v
        {galleryContract.uiContractVersion} and skin {galleryContract.skinId}.
      </p>
      <p>
        Component anatomy, behavior cases, stress skin, and visual matrices
        begin in later milestones.
      </p>
    </main>
  </StrictMode>,
);
