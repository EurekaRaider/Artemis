import CleanCSS from "clean-css";

/** Preserve selector precedence and runtime-selected rules while deduplicating CSS. */
export function desktopCssOptimization() {
  return {
    name: "artemis-desktop-css-optimization",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".css"))
          continue;
        const source =
          typeof asset.source === "string"
            ? asset.source
            : Buffer.from(asset.source).toString("utf8");
        const result = new CleanCSS({
          level: {
            1: { all: false },
            2: {
              mergeSemantically: false,
              removeUnusedAtRules: false,
              restructureRules: false,
            },
          },
        }).minify(source);
        if (result.errors.length > 0 || result.warnings.length > 0) {
          this.error([...result.errors, ...result.warnings].join("\n"));
        }
        asset.source = result.styles;
      }
    },
  };
}
