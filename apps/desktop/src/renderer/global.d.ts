import type { ArtemisApi } from "../shared/api.js";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

interface WebviewAttributes extends DetailedHTMLProps<
  HTMLAttributes<Electron.WebviewTag>,
  Electron.WebviewTag
> {
  partition?: string;
  src?: string;
}

declare global {
  interface Window {
    artemis: ArtemisApi;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewAttributes;
    }
  }
}

export {};
