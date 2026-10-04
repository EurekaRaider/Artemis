import { test } from "node:test";
import assert from "node:assert/strict";
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
