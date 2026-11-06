import { test } from "node:test";
import assert from "node:assert/strict";
import postcss from "postcss";
import { desktopCssOptimization } from "./desktop-css-optimization.mjs";
const optimize = (source) => {
  const asset = { type: "asset", fileName: "desktop.css", source };
  desktopCssOptimization().generateBundle.call(
    {
      error(message) {
        throw Error(message);
      },
    },
    {},
    { css: asset },
  );
  return asset.source;
};
test("removes only identical Chromium prefix fallbacks", () => {
  assert.equal(
    optimize(".a{-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}"),
    ".a{backdrop-filter:blur(4px)}",
  );
  assert.equal(
    optimize(".a{-webkit-user-select:none;user-select:none}"),
    ".a{user-select:none}",
  );
  assert.match(
    optimize(".a{-webkit-user-select:none;user-select:text}"),
    /-webkit-user-select:none/,
  );
  assert.match(
    optimize(".a{-webkit-user-select:none!important;user-select:none}"),
    /-webkit-user-select:none!important/,
  );
  assert.match(optimize(".a{-webkit-line-clamp:2}"), /-webkit-line-clamp:2/);
});

test("keeps native nesting as a barrier between flat rule optimizations", () => {
  const nested = ".panel{& .item{color:blue}&>.item{padding:4px}}";
  const result = optimize(`.item{color:red}${nested}.item{color:green}`);
  assert.deepEqual(
    postcss.parse(result).nodes.map((node) => node.toString()),
    [".item{color:red}", nested, ".item{color:green}"],
  );
  assert.equal(
    optimize(".a{color:red}.a{padding:4px}"),
    ".a{color:red;padding:4px}",
  );
});

test("preserves mixed declarations, ampersands, and nested conditional order", () => {
  const source =
    ".panel{color:red;&{color:blue}@media(min-width:800px){color:green;&>.item{padding:4px}}color:purple;@container work (max-width:400px){& .item{padding:2px}}color:black}";
  assert.equal(optimize(source), source);
});

test("retains nesting inside media and container rules and declaration-only conditions", () => {
  for (const source of [
    "@media(min-width:800px){.panel{& .item{color:blue}}}",
    "@container work (max-width:400px){.panel{&>.item{padding:2px}}}",
    ".panel{@media(min-width:800px){color:green}}",
  ]) {
    assert.equal(optimize(source), source);
  }
});

test("removes only identical prefix fallbacks inside preserved nesting", () => {
  assert.equal(
    optimize(
      ".panel{& .item{-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}& .other{-webkit-user-select:none;user-select:text}}",
    ),
    ".panel{& .item{backdrop-filter:blur(4px)}& .other{-webkit-user-select:none;user-select:text}}",
  );
});

test("preserves charset, import, and layer statement terminators around nesting", () => {
  const source =
    '@charset "UTF-8";@import url("theme.css");@layer reset,app;.panel{& .item{color:red}}@layer later;.tail{color:green}';
  assert.equal(optimize(source), source);
  const nodes = postcss.parse(optimize(source)).nodes;
  assert.deepEqual(
    nodes.map((node) =>
      node.type === "atrule" ? [node.name, node.params] : node.selector,
    ),
    [
      ["charset", '"UTF-8"'],
      ["import", 'url("theme.css")'],
      ["layer", "reset,app"],
      ".panel",
      ["layer", "later"],
      ".tail",
    ],
  );
});

test("emits fonts and provider artwork as shared assets without changing other inlining", async () => {
  const { desktopAssetInlining } =
    await import("./desktop-css-optimization.mjs");
  assert.equal(typeof desktopAssetInlining, "function");
  assert.equal(
    desktopAssetInlining(
      "/node_modules/katex/dist/fonts/KaTeX_Size4-Regular.woff2",
    ),
    false,
  );
  assert.equal(desktopAssetInlining("C:\\app\\fonts\\interface.woff2"), false);
  assert.equal(
    desktopAssetInlining("/src/settings/assets/provider.svg"),
    false,
  );
  assert.equal(desktopAssetInlining("/src/icons/inline.svg"), undefined);
});
