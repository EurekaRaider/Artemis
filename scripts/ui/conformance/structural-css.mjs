import postcss from "postcss";
import {
  normalizeWhitespace,
  normalizeSelector,
  normalizeValue,
  canonical,
} from "./css-normalization.mjs";
import { expectedCssRules } from "./core-rules.mjs";

export function verifyStructuralCss(css, from, tokenFamilies) {
  const parsed = postcss.parse(css, { from });
  const rootNodes = parsed.nodes ?? [];
  if (rootNodes.length !== 2) {
    throw new Error("UI structural CSS must contain exactly two root at-rules");
  }

  const [layerOrder, uiLayer] = rootNodes;
  if (
    layerOrder.type !== "atrule" ||
    layerOrder.name !== "layer" ||
    normalizeWhitespace(layerOrder.params) !==
      "artemis.reset, artemis.theme, artemis.ui" ||
    layerOrder.nodes !== undefined
  ) {
    throw new Error("UI structural CSS layer order is not exact");
  }
  if (
    uiLayer.type !== "atrule" ||
    uiLayer.name !== "layer" ||
    normalizeWhitespace(uiLayer.params) !== "artemis.ui" ||
    uiLayer.nodes === undefined
  ) {
    throw new Error("UI structural CSS must use only @layer artemis.ui");
  }

  let commentCount = 0;
  parsed.walkComments(() => {
    commentCount += 1;
  });
  if (commentCount !== 0) {
    throw new Error("UI structural CSS comments are not allowed");
  }

  const seenRules = new Set();
  const consumedTokens = new Set();
  const familyConsumption = tokenFamilies.map((family) => ({
    ...family,
    consumedTokens: new Set(),
    markers: [
      ...family.components.map(
        (component) => `[data-artemis-component="${component}"]`,
      ),
      ...(family.extraMarkers ?? []),
    ],
  }));
  let loadingKeyframes = 0;
  const verifyRule = (rule, context) => {
    if (rule.type !== "rule") {
      throw new Error("UI structural CSS contains an unexpected nested node");
    }
    const selector = normalizeSelector(rule.selector);
    const key = `${context}|${selector}`;
    const expected = expectedCssRules.get(key);
    if (expected === undefined) {
      throw new Error(`UI structural CSS selector is not allowed: ${selector}`);
    }
    if (seenRules.has(key)) {
      throw new Error(`UI structural CSS rule is duplicated: ${selector}`);
    }
    seenRules.add(key);

    const matchingFamilies = familyConsumption.filter((family) =>
      family.markers.some((marker) => selector.includes(marker)),
    );
    if (matchingFamilies.length === 0 && context !== "forced-colors") {
      throw new Error(
        `UI structural CSS selector must belong to a public family: ${selector}`,
      );
    }

    const declarations = new Map();
    for (const node of rule.nodes ?? []) {
      if (node.type !== "decl") {
        throw new Error(
          `UI structural CSS rule contains a non-declaration: ${selector}`,
        );
      }
      if (node.important) {
        throw new Error(
          `UI structural CSS must not use !important: ${node.prop}`,
        );
      }
      if (declarations.has(node.prop)) {
        throw new Error(
          `UI structural CSS declaration is duplicated: ${node.prop}`,
        );
      }
      const value = normalizeValue(node.value);
      declarations.set(node.prop, value);
      for (const match of value.matchAll(
        /var\(\s*(--artemis-[a-z0-9]+(?:-[a-z0-9]+)*)\s*\)/gu,
      )) {
        consumedTokens.add(match[1]);
        for (const matchingFamily of matchingFamilies) {
          matchingFamily.consumedTokens.add(match[1]);
        }
      }
    }

    const expectedEntries = Object.entries(expected);
    if (declarations.size !== expectedEntries.length) {
      throw new Error(
        `UI structural CSS declarations are not exact for: ${selector}`,
      );
    }
    for (const [property, expectedValue] of expectedEntries) {
      if (declarations.get(property) !== normalizeValue(expectedValue)) {
        throw new Error(
          `UI structural CSS value is not allowed: ${property}: ${String(declarations.get(property))}`,
        );
      }
    }
  };

  for (const node of uiLayer.nodes) {
    if (node.type === "rule") {
      verifyRule(node, "normal");
      continue;
    }
    if (
      node.type === "atrule" &&
      node.name === "keyframes" &&
      normalizeWhitespace(node.params) === "artemis-loading-sweep"
    ) {
      loadingKeyframes += 1;
      const frames = node.nodes ?? [];
      const frame = frames[0];
      const declaration = frame?.nodes?.[0];
      if (
        loadingKeyframes !== 1 ||
        frames.length !== 1 ||
        frame?.type !== "rule" ||
        normalizeWhitespace(frame.selector) !== "to" ||
        frame.nodes?.length !== 1 ||
        declaration?.type !== "decl" ||
        declaration.prop !== "background-position" ||
        normalizeValue(declaration.value) !== "-200% 0" ||
        declaration.important
      ) {
        throw new Error("UI loading keyframes do not match the exact contract");
      }
      continue;
    }
    if (node.type !== "atrule" || node.name !== "media" || !node.nodes) {
      throw new Error("UI structural CSS contains an unexpected at-rule");
    }
    const media = normalizeWhitespace(node.params);
    if (media === "(forced-colors: active)" && node.nodes.length === 1) {
      verifyRule(node.nodes[0], "forced-colors");
      continue;
    }
    if (media === "(max-width: 1100px)" && node.nodes.length === 5) {
      for (const nested of node.nodes) verifyRule(nested, "compact-width");
      continue;
    }
    if (media === "(max-width: 52rem)" && node.nodes.length === 10) {
      for (const nested of node.nodes) verifyRule(nested, "compact-width");
      continue;
    }
    if (media === "(max-width: 820px)" && node.nodes.length === 5) {
      for (const nested of node.nodes) verifyRule(nested, "narrow-width");
      continue;
    }
    if (
      media === "(prefers-reduced-motion: reduce)" &&
      node.nodes.length === 17
    ) {
      for (const nested of node.nodes) verifyRule(nested, "reduced-motion");
      continue;
    }
    throw new Error("UI structural CSS contains an unexpected at-rule");
  }

  if (loadingKeyframes !== 1) {
    throw new Error("UI loading keyframes are missing");
  }

  if (
    seenRules.size !== expectedCssRules.size ||
    [...expectedCssRules.keys()].some((key) => !seenRules.has(key))
  ) {
    throw new Error("UI structural CSS is missing a required rule");
  }

  const actualTokens = [...consumedTokens].sort();
  const declaredTokens = [
    ...new Set(tokenFamilies.flatMap((family) => family.mutableTokens)),
  ].sort();
  if (canonical(actualTokens) !== canonical(declaredTokens)) {
    throw new Error(
      `UI structural CSS tokens differ from ComponentContract: CSS=${canonical(actualTokens)} contract=${canonical(declaredTokens)}`,
    );
  }
  for (const family of familyConsumption) {
    const declared = new Set(family.mutableTokens);
    const undeclared = [...family.consumedTokens]
      .filter((token) => !declared.has(token))
      .sort();
    if (undeclared.length > 0) {
      throw new Error(
        `UI ${family.label} structural CSS consumes tokens outside its family contract: ${canonical(undeclared)}`,
      );
    }
  }
}
