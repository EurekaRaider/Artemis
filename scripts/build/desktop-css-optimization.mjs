import CleanCSS from "clean-css";
import postcss from "postcss";

// Emit fonts once instead of embedding base64 bytes in CSS. Keep local asset
// URLs so packaged file:// loading and lazy styles use the same font files.
export function desktopAssetInlining(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (
    /\.(?:woff2?|ttf|otf)$/i.test(normalized) ||
    normalized.includes("/settings/assets/")
  )
    return false;
  return undefined;
}

function containsCssNesting(node) {
  let nested = false;
  const inspect = (rule) => {
    if (
      rule.nodes?.some(
        (child) => child.type === "rule" || child.type === "atrule",
      )
    )
      nested = true;
  };
  if (node.type === "rule") inspect(node);
  node.walkRules?.(inspect);
  return nested;
}

function containsAtRuleStatement(node) {
  let statement = node.type === "atrule" && node.nodes === undefined;
  node.walkAtRules?.((rule) => {
    if (rule.nodes === undefined) statement = true;
  });
  return statement;
}

function serializeNodes(nodes) {
  return postcss
    .root({
      nodes: nodes.map((node) => node.clone()),
      raws: { semicolon: true },
    })
    .toString();
}

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
        const optimizeFlat = (source) => {
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
          return result.styles;
        };
        const output = [];
        let flat = [];
        const flush = () => {
          if (flat.length === 0) return;
          output.push(optimizeFlat(serializeNodes(flat)));
          flat = [];
        };
        for (const node of css.nodes) {
          if (containsCssNesting(node) || containsAtRuleStatement(node)) {
            // CleanCSS 5 cannot parse nesting. Vite already minified this
            // subtree; keep it intact and never merge rules across it. Keep
            // at-rule statements and their terminators in their original order.
            flush();
            output.push(serializeNodes([node]));
          } else {
            flat.push(node);
          }
        }
        flush();
        asset.source = output.join("");
      }
    },
  };
}
