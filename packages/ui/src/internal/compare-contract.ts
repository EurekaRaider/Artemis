interface ContractDiagnostics {
  readonly distinguishArrayType?: boolean;
  readonly formatValue?: (value: unknown) => string | undefined;
}

// Public validators retain their existing diagnostics: navigation/forms/actions
// distinguish non-arrays, while professional/workflow use unquoted values.
export function compareExactContract(
  actual: unknown,
  expected: unknown,
  path: string,
  errors: string[],
  diagnostics: ContractDiagnostics = {},
): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) && diagnostics.distinguishArrayType) {
      errors.push(`${path} must be an array`);
      return;
    }
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      errors.push(`${path} must contain ${expected.length} entries`);
      return;
    }
    expected.forEach((entry, index) =>
      compareExactContract(
        actual[index],
        entry,
        `${path}[${index}]`,
        errors,
        diagnostics,
      ),
    );
    return;
  }
  if (typeof expected === "object" && expected !== null) {
    if (
      typeof actual !== "object" ||
      actual === null ||
      Array.isArray(actual)
    ) {
      errors.push(`${path} must be an object`);
      return;
    }
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const actualKeys = Object.keys(actualRecord).sort();
    const expectedKeys = Object.keys(expectedRecord).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      errors.push(`${path} fields are not exact`);
      return;
    }
    for (const key of expectedKeys) {
      compareExactContract(
        actualRecord[key],
        expectedRecord[key],
        `${path}.${key}`,
        errors,
        diagnostics,
      );
    }
    return;
  }
  if (actual !== expected) {
    const format = diagnostics.formatValue ?? JSON.stringify;
    errors.push(`${path} must equal ${format(expected)}`);
  }
}
