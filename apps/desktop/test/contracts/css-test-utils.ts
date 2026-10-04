import postcss from "postcss";

/** Read normal declarations across grouped selectors without including media overrides. */
export function findCssDeclarations(
  source: string,
  selector: string,
): string | undefined {
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  const expected = postcss.list.comma(selector).map(normalize);
  const matches: string[] = [];
  postcss.parse(source).walkRules((rule) => {
    if (
      rule.parent?.type !== "root" &&
      !(rule.parent?.type === "atrule" && rule.parent.name === "layer")
    )
      return;
    if (
      !expected.every((part) =>
        postcss.list.comma(rule.selector).map(normalize).includes(part),
      )
    )
      return;
    matches.push(
      rule.nodes
        .filter((node) => node.type === "decl")
        .map((node) => `${node.toString()};`)
        .join("\n"),
    );
  });
  return matches.length > 0 ? matches.join("\n") : undefined;
}
