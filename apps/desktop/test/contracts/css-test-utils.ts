import postcss, { type Rule } from "postcss";

function resolvedSelectors(rule: Rule): string[] {
  let parent = rule.parent;
  while (parent !== undefined && parent.type !== "rule") {
    parent = parent.parent;
  }
  if (parent === undefined) return rule.selectors;
  const ancestors = resolvedSelectors(parent);
  const scope =
    ancestors.length === 1 ? ancestors[0]! : `:is(${ancestors.join(", ")})`;
  return rule.selectors.map((selector) =>
    selector.includes("&")
      ? selector.replaceAll("&", scope)
      : `${scope} ${selector}`,
  );
}

/** Read normal declarations across grouped selectors without including media overrides. */
export function findCssDeclarations(
  source: string,
  selector: string,
): string | undefined {
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  const expected = postcss.list.comma(selector).map(normalize);
  const matches: string[] = [];
  postcss.parse(source).walkRules((rule) => {
    for (
      let parent = rule.parent;
      parent !== undefined;
      parent = parent.parent
    ) {
      if (parent.type === "atrule" && parent.name !== "layer") return;
    }
    const selectors = resolvedSelectors(rule).map(normalize);
    if (!expected.every((part) => selectors.includes(part))) return;
    matches.push(
      rule.nodes
        .filter((node) => node.type === "decl")
        .map((node) => `${node.toString()};`)
        .join("\n"),
    );
  });
  return matches.length > 0 ? matches.join("\n") : undefined;
}
