/** Bundle local prototype assets for copied audit harnesses and single-file previews. */
const fs = require("node:fs");
const path = require("node:path");
function localAsset(base, name, root) {
  // 版本参数（?v=N）只用于缓存击穿，解析文件路径时剥除
  const clean = name.split("?")[0];
  if (/^(?:[a-z]+:|\/\/)/i.test(clean))
    throw new Error("Only local prototype assets can be bundled: " + name);
  const resolved = path.resolve(base, clean);
  if (!resolved.startsWith(root + path.sep))
    throw new Error("Asset outside prototype: " + name);
  return resolved;
}
function inlineAssets(filename) {
  const root = path.dirname(path.resolve(filename));
  function css(file, chain = []) {
    if (chain.includes(file)) throw new Error("Circular CSS import: " + file);
    return fs
      .readFileSync(file, "utf8")
      .replace(
        /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/g,
        (_, name) =>
          css(localAsset(path.dirname(file), name, root), [...chain, file]),
      );
  }
  return fs
    .readFileSync(filename, "utf8")
    .replace(/<link\b([^>]+)>/g, (tag, attrs) => {
      if (!/rel=["']stylesheet["']/.test(attrs)) return tag;
      const href = attrs.match(/href=["']([^"']+)["']/);
      if (!href) return tag;
      return "<style>\n" + css(localAsset(root, href[1], root)) + "\n</style>";
    })
    .replace(
      /<script\s+src=["']([^"']+)["']\s*><\/script>/g,
      (_, name) =>
        "<script>\n" +
        fs
          .readFileSync(localAsset(root, name, root), "utf8")
          .replace(/<\/script/gi, "<\\/script") +
        "\n</script>",
    );
}
module.exports = { inlineAssets };
if (require.main === module) {
  const [, , input, output] = process.argv;
  if (!input || !output)
    throw new Error("Usage: node inline-assets.cjs input.html output.html");
  fs.writeFileSync(output, inlineAssets(input));
}
