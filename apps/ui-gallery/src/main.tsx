import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@artemis/theme-artemis/theme.css";
import "@artemis/ui/styles.css";
import "./gallery.css";
import {
  applyGallerySkin,
  GalleryApp,
  installGalleryStressSkinStyles,
} from "./gallery-app.js";

applyGallerySkin("default");
installGalleryStressSkinStyles();

const mount = document.querySelector<HTMLDivElement>("#root");
if (mount === null) throw new Error("Missing UI Gallery root");

createRoot(mount).render(
  <StrictMode>
    <GalleryApp />
  </StrictMode>,
);
