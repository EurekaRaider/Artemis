import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postcss from "postcss";

// Source-level checks must follow the same ordered local imports as Vite.
// Keeping the parsed nodes also retains each declaration's owning filename.
export function readStylesheet(file, ancestors = new Set()) {
  const path = resolve(file);
  if (ancestors.has(path)) throw new Error(`Circular CSS import: ${path}`);
  const chain = new Set([...ancestors, path]);
  const root = postcss.parse(readFileSync(path, "utf8"), { from: path });
  root.walkAtRules("import", (rule) => {
    const local = /^(["'])(\.\.?\/[^"']+)\1$/.exec(rule.params);
    if (local)
      rule.replaceWith(
        readStylesheet(resolve(dirname(path), local[2]), chain).nodes,
      );
  });
  return root;
}
