import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStylesheet } from "../../../../../scripts/build/css-source.mjs";

export function readDesktopStyles(
  name: "styles" | "nocturne" | "desktop-composition",
): string {
  return readStylesheet(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      `../../../src/renderer/styles/${name}.css`,
    ),
  ).toString();
}
