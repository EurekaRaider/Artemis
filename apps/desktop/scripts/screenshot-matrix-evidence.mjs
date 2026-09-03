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
  const locales = [...new Set(variants.map((variant) => variant.locale))];
  const requiredDistinctGroups = locales
    .map((locale) => {
      const localeVariants = variants.filter(
        (variant) => variant.locale === locale,
      );
      return {
        basis: "locale",
        value: locale,
        variantIds: localeVariants.map((variant) => variant.id),
        distinctScreenshotCount: new Set(
          localeVariants.map((variant) => variant.screenshotSha256),
        ).size,
        duplicateGroups: duplicateScreenshotGroups(localeVariants),
      };
    })
    .filter((group) => group.variantIds.length > 1);
  const violations = requiredDistinctGroups.flatMap((group) =>
    group.duplicateGroups.map(
      (duplicate) =>
        `locale ${group.value}: ${duplicate.variantIds.join(", ")} share screenshot ${duplicate.screenshotSha256}`,
    ),
  );

  return {
    policy:
      "Every same-locale variant with a different theme, zoom, motion, or viewport contract must render a distinct screenshot. Cross-locale duplicate hashes are reported but do not fail because the visible fixture may contain no translated text.",
    distinctScreenshotCount: new Set(
      variants.map((variant) => variant.screenshotSha256),
    ).size,
    duplicateGroups,
    requiredDistinctGroups,
    violations,
  };
}
