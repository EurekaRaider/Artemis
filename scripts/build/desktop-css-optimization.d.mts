import type { Plugin } from "vite";

export function desktopCssOptimization(): Plugin;

export function desktopAssetInlining(filePath: string): false | undefined;
