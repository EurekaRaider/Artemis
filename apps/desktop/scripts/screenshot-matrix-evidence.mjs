function duplicateScreenshotGroups(variants) {
  const variantsByHash = new Map();
  for (const variant of variants) {
    const matching = variantsByHash.get(variant.screenshotSha256) ?? [];
    matching.push(variant.id);
    variantsByHash.set(variant.screenshotSha256, matching);
  }
  return [...variantsByHash.entries()]
    .filter(([, variantIds]) => variantIds.length > 1)
    .map(([screenshotSha256, variantIds]) => ({
      screenshotSha256,
      variantIds,
    }));
}

export function evaluateScreenshotMatrixVisualEvidence(variants) {
  const duplicateGroups = duplicateScreenshotGroups(variants);
  const requiredDistinctPairs = [];
  for (const [index, left] of variants.entries()) {
    for (const right of variants.slice(index + 1)) {
      if (left.locale !== right.locale) continue;
      const reasons = [];
      if (left.resolvedTheme !== right.resolvedTheme) {
        reasons.push("resolved-theme");
      }
      if (left.width !== right.width || left.height !== right.height) {
        reasons.push("physical-viewport");
      }
      if (reasons.length === 0) continue;
      requiredDistinctPairs.push({
        variantIds: [left.id, right.id],
        reasons,
        passed: left.screenshotSha256 !== right.screenshotSha256,
      });
    }
  }
  const violations = requiredDistinctPairs
    .filter((pair) => !pair.passed)
    .map(
      (pair) =>
        `${pair.variantIds.join(" and ")} share a screenshot despite different ${pair.reasons.join(" and ")}`,
    );

  return {
    policy:
      "Same-locale variants with different resolved themes or physical window viewports must render distinct screenshots. All duplicate hashes are reported. Locale, direction, zoom, reduced motion, and the zoom-adjusted CSS viewport remain separate runtime assertions because they may not change the captured pixels.",
    distinctScreenshotCount: new Set(
      variants.map((variant) => variant.screenshotSha256),
    ).size,
    duplicateGroups,
    requiredDistinctPairs,
    violations,
  };
}
