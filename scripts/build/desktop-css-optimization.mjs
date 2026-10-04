import CleanCSS from "clean-css";
import postcss from "postcss";

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
        // Electron's Chromium supports these unprefixed properties. Remove
        // only an identical prefixed fallback in the same rule; keep differing
        // values and all other prefixes so the cascade stays unchanged.
        const css = postcss.parse(source);
        css.walkDecls((declaration) => {
          if (
            !new Set(["-webkit-backdrop-filter", "-webkit-user-select"]).has(
              declaration.prop,
            )
          )
            return;
          const property = declaration.prop.slice("-webkit-".length);
          if (
            declaration.parent.nodes.some(
              (node) =>
                node.type === "decl" &&
                node.prop === property &&
                node.value === declaration.value &&
                node.important === declaration.important,
            )
          )
            declaration.remove();
        });
        const result = new CleanCSS({
          level: {
            1: { all: false },
            2: {
              mergeSemantically: false,
              removeUnusedAtRules: false,
              restructureRules: false,
            },
          },
        }).minify(css.toString());
        if (result.errors.length > 0 || result.warnings.length > 0) {
          this.error([...result.errors, ...result.warnings].join("\n"));
        }
        asset.source = result.styles;
      }
    },
  };
}
