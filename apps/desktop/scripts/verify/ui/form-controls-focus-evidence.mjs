function normalizeColor(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/gu, "");
  if (/^#[\da-f]{6}$/u.test(normalized)) {
    return `rgb(${[1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)).join(",")})`;
  }
  return normalized;
}

export function evaluateFormControlFocusEvidence({
  windowFocused,
  documentHasFocus,
  component,
  focusRing,
  forcedColors = false,
  visual = false,
}) {
  const actual = {
    windowFocused,
    documentHasFocus,
    documentActive: component?.control?.documentActive,
    tabIndex: component?.control?.tabIndex,
    outlineStyle: visual
      ? component?.focus?.visualOutlineStyle
      : component?.focus?.outlineStyle,
    outlineWidth: visual
      ? component?.focus?.visualOutlineWidth
      : component?.focus?.outlineWidth,
    outlineColor: visual
      ? component?.focus?.visualOutlineColor
      : component?.focus?.outlineColor,
    focusRing,
    forcedColors,
  };
  const outlineColor = normalizeColor(actual.outlineColor);
  const expectedColor = normalizeColor(focusRing);
  const pass =
    windowFocused === true &&
    documentHasFocus === true &&
    actual.documentActive === true &&
    typeof actual.tabIndex === "number" &&
    actual.tabIndex >= 0 &&
    actual.outlineStyle === "solid" &&
    Number.parseFloat(actual.outlineWidth) > 0 &&
    Boolean(outlineColor) &&
    outlineColor !== "transparent" &&
    outlineColor !== "rgba(0,0,0,0)" &&
    (forcedColors === true ||
      (Boolean(expectedColor) && outlineColor === expectedColor));
  return { pass, actual };
}
