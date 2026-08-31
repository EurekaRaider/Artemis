import {
  OPTIONAL_SEMANTIC_TOKENS,
  REQUIRED_SEMANTIC_TOKENS,
  SAFE_FALLBACK_TOKENS,
  SEMANTIC_TOKEN_REGISTRY,
  type SemanticTokenName,
} from "./registry.js";
import {
  SKIN_CONTRAST_TOKEN_FILE_NAME,
  SKIN_DARK_TOKEN_FILE_NAME,
  SKIN_LIGHT_TOKEN_FILE_NAME,
  SKIN_MANIFEST_FILE_NAME,
  THEME_SCHEMA_VERSION,
  UI_CONTRACT_RANGE,
  UI_CONTRACT_VERSION,
  type ConformanceIssue,
  type ConformanceIssueCode,
  type ConformanceReport,
  type ContrastMode,
  type DensityMode,
  type PlatformCapability,
  type ResolvedThemeMode,
  type SemanticTokenDefinition,
  type SkinIntegrity,
  type SkinManifest,
  type ThemeMode,
  type ThemeTokenDocument,
  type ThemeTokenMode,
  type ThemeTokenValue,
  type ValidatedSkinPackage,
} from "./types.js";

const THEME_MODES = ["light", "dark"] as const;
const CONTRAST_MODES = ["normal", "high"] as const;
const DENSITIES = ["comfortable", "compact"] as const;
const PLATFORMS = ["universal", "macos", "windows", "linux"] as const;
const MANIFEST_FIELDS = [
  "schemaVersion",
  "id",
  "name",
  "version",
  "uiContract",
  "modes",
  "tokens",
  "capabilities",
] as const;
const TOKEN_FILE_FIELDS = ["light", "dark", "contrast"] as const;
const CAPABILITY_FIELDS = ["contrastModes", "densities", "platforms"] as const;
const DOCUMENT_FIELDS = ["schemaVersion", "skinId", "modes"] as const;
const MODE_FIELDS = [
  "theme",
  "contrast",
  "density",
  "platform",
  "tokens",
] as const;
const PACKAGE_FIELDS = ["manifest", "tokenDocuments"] as const;
const INTEGRITY_FIELDS = ["algorithm", "files"] as const;
const INTEGRITY_FILE_NAMES = [
  SKIN_MANIFEST_FILE_NAME,
  SKIN_LIGHT_TOKEN_FILE_NAME,
  SKIN_DARK_TOKEN_FILE_NAME,
  SKIN_CONTRAST_TOKEN_FILE_NAME,
] as const;
const SKIN_ID_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;
const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(
  issues: ConformanceIssue[],
  code: ConformanceIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
  issues: ConformanceIssue[],
): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      issue(
        issues,
        "unknown_field",
        `${path}.${field}`,
        `Unknown field: ${field}`,
      );
    }
  }
}

function stringValue(
  value: unknown,
  path: string,
  pattern: RegExp,
  issues: ConformanceIssue[],
): value is string {
  if (typeof value !== "string") {
    issue(issues, "invalid_type", path, "Expected a string");
    return false;
  }
  if (!pattern.test(value)) {
    issue(issues, "invalid_value", path, "String is outside the v1 allowlist");
    return false;
  }
  return true;
}

function skinIdValue(
  value: unknown,
  path: string,
  issues: ConformanceIssue[],
): value is string {
  if (!stringValue(value, path, SKIN_ID_PATTERN, issues)) return false;
  if (value.length > 128) {
    issue(issues, "invalid_value", path, "Skin ID exceeds 128 characters");
    return false;
  }
  return true;
}

function allowedArray<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  path: string,
  issues: ConformanceIssue[],
): value is readonly T[] {
  if (!Array.isArray(value) || value.length === 0) {
    issue(issues, "invalid_type", path, "Expected a non-empty array");
    return false;
  }
  const allowed = new Set<string>(allowedValues);
  let valid = true;
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !allowed.has(item)) {
      issue(
        issues,
        "unsupported_capability",
        `${path}[${index}]`,
        "Capability is not in the v1 allowlist",
      );
      valid = false;
    }
  }
  if (new Set(value).size !== value.length) {
    issue(issues, "invalid_value", path, "Capability values must be unique");
    valid = false;
  }
  return valid;
}

export function isUiContractCompatible(
  range: unknown,
  supportedVersion = UI_CONTRACT_VERSION,
): range is typeof UI_CONTRACT_RANGE {
  return (
    range === UI_CONTRACT_RANGE && supportedVersion === UI_CONTRACT_VERSION
  );
}

export function validateSkinManifest(
  input: unknown,
): ConformanceReport<SkinManifest> {
  const issues: ConformanceIssue[] = [];
  if (!record(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "invalid_type",
          path: "$",
          message: "Expected a manifest object",
        },
      ],
    };
  }

  rejectUnknownFields(input, MANIFEST_FIELDS, "$", issues);
  if (input.schemaVersion !== THEME_SCHEMA_VERSION) {
    issue(
      issues,
      "invalid_value",
      "$.schemaVersion",
      "Only schemaVersion 1 is supported",
    );
  }
  skinIdValue(input.id, "$.id", issues);
  stringValue(input.name, "$.name", DISPLAY_NAME_PATTERN, issues);
  stringValue(input.version, "$.version", SEMVER_PATTERN, issues);
  if (!isUiContractCompatible(input.uiContract)) {
    issue(
      issues,
      "incompatible_ui_contract",
      "$.uiContract",
      `Expected ${UI_CONTRACT_RANGE}`,
    );
  }

  const modes = input.modes;
  const modesValid = allowedArray(modes, THEME_MODES, "$.modes", issues);
  if (modesValid && (!modes.includes("light") || !modes.includes("dark"))) {
    issue(
      issues,
      "missing_mode",
      "$.modes",
      "Skin v1 requires both light and dark modes",
    );
  }

  if (!record(input.tokens)) {
    issue(issues, "invalid_type", "$.tokens", "Expected an object");
  } else {
    rejectUnknownFields(input.tokens, TOKEN_FILE_FIELDS, "$.tokens", issues);
    const expectedTokenFiles = {
      light: SKIN_LIGHT_TOKEN_FILE_NAME,
      dark: SKIN_DARK_TOKEN_FILE_NAME,
      contrast: SKIN_CONTRAST_TOKEN_FILE_NAME,
    } as const;
    for (const key of ["light", "dark"] as const) {
      if (input.tokens[key] !== expectedTokenFiles[key]) {
        issue(
          issues,
          "invalid_value",
          `$.tokens.${key}`,
          `Expected ${expectedTokenFiles[key]}`,
        );
      }
    }
    if (
      input.tokens.contrast !== undefined &&
      input.tokens.contrast !== expectedTokenFiles.contrast
    ) {
      issue(
        issues,
        "invalid_value",
        "$.tokens.contrast",
        `Expected ${expectedTokenFiles.contrast}`,
      );
    }
  }

  if (!record(input.capabilities)) {
    issue(issues, "invalid_type", "$.capabilities", "Expected an object");
  } else {
    rejectUnknownFields(
      input.capabilities,
      CAPABILITY_FIELDS,
      "$.capabilities",
      issues,
    );
    const contrastModes = input.capabilities.contrastModes;
    const contrastValid = allowedArray(
      contrastModes,
      CONTRAST_MODES,
      "$.capabilities.contrastModes",
      issues,
    );
    allowedArray(
      input.capabilities.densities,
      DENSITIES,
      "$.capabilities.densities",
      issues,
    );
    allowedArray(
      input.capabilities.platforms,
      PLATFORMS,
      "$.capabilities.platforms",
      issues,
    );
    if (contrastValid && !contrastModes.includes("normal")) {
      issue(
        issues,
        "missing_mode",
        "$.capabilities.contrastModes",
        "The normal contrast mode is required",
      );
    }
    const declaresHigh = contrastValid && contrastModes.includes("high");
    const hasContrastFile = record(input.tokens)
      ? input.tokens.contrast !== undefined
      : false;
    if (declaresHigh !== hasContrastFile) {
      issue(
        issues,
        "manifest_mismatch",
        "$.tokens.contrast",
        "tokens.contrast and the high contrast capability must be declared together",
      );
    }
  }

  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, issues, value: input as unknown as SkinManifest };
}

export function validateSkinIntegrity(
  input: unknown,
  manifestInput: unknown,
): ConformanceReport<SkinIntegrity> {
  const manifestReport = validateSkinManifest(manifestInput);
  if (!manifestReport.valid || manifestReport.value === undefined) {
    return {
      valid: false,
      issues: manifestReport.issues.map((manifestIssue) => ({
        ...manifestIssue,
        path: `$.manifest${manifestIssue.path.slice(1)}`,
      })),
    };
  }
  const issues: ConformanceIssue[] = [];
  if (!record(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "invalid_type",
          path: "$",
          message: "Expected an integrity object",
        },
      ],
    };
  }
  rejectUnknownFields(input, INTEGRITY_FIELDS, "$", issues);
  if (input.algorithm !== "sha256") {
    issue(issues, "invalid_value", "$.algorithm", "Only sha256 is supported");
  }
  if (!record(input.files)) {
    issue(issues, "invalid_type", "$.files", "Expected a file hash map");
    return { valid: false, issues };
  }

  const expectedFiles = new Set<string>([
    SKIN_MANIFEST_FILE_NAME,
    ...Object.values(manifestReport.value.tokens),
  ]);
  const allowedFiles = new Set<string>(INTEGRITY_FILE_NAMES);
  for (const file of Object.keys(input.files)) {
    if (!allowedFiles.has(file) || !expectedFiles.has(file)) {
      issue(
        issues,
        "unknown_integrity_file",
        `$.files.${file}`,
        `Integrity file is not declared by the manifest: ${file}`,
      );
    }
    const hash = input.files[file];
    if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) {
      issue(
        issues,
        "invalid_hash",
        `$.files.${file}`,
        "Expected a 64-character lowercase sha256 hex digest",
      );
    }
  }
  for (const file of expectedFiles) {
    if (!Object.hasOwn(input.files, file)) {
      issue(
        issues,
        "missing_integrity_file",
        `$.files.${file}`,
        `Integrity hash is missing: ${file}`,
      );
    }
  }

  if (issues.length > 0) return { valid: false, issues };
  return {
    valid: true,
    issues,
    value: input as unknown as SkinIntegrity,
  };
}

function validateTokenValue(
  input: unknown,
  name: SemanticTokenName,
  path: string,
  issues: ConformanceIssue[],
): input is ThemeTokenValue {
  if (!record(input)) {
    issue(issues, "invalid_type", path, "Expected a structured token value");
    return false;
  }
  const definition: SemanticTokenDefinition = SEMANTIC_TOKEN_REGISTRY[name];
  const expectedFields =
    definition.kind === "length" || definition.kind === "duration"
      ? ["kind", "value", "unit"]
      : ["kind", "value"];
  rejectUnknownFields(input, expectedFields, path, issues);
  if (input.kind !== definition.kind) {
    issue(
      issues,
      "invalid_value",
      `${path}.kind`,
      `Expected ${definition.kind}`,
    );
    return false;
  }

  if (definition.kind === "color") {
    return stringValue(input.value, `${path}.value`, COLOR_PATTERN, issues);
  }
  if (definition.kind === "length" || definition.kind === "duration") {
    const expectedUnit = definition.kind === "length" ? "px" : "ms";
    if (input.unit !== expectedUnit) {
      issue(
        issues,
        "invalid_value",
        `${path}.unit`,
        `Expected ${expectedUnit}`,
      );
    }
  }
  if (definition.allowedValues !== undefined) {
    if (!definition.allowedValues.includes(input.value as string | number)) {
      issue(
        issues,
        "invalid_value",
        `${path}.value`,
        "Value is outside the allowlist",
      );
      return false;
    }
    return issues.every((entry) => !entry.path.startsWith(path));
  }
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    issue(issues, "invalid_type", `${path}.value`, "Expected a finite number");
    return false;
  }
  if (
    (definition.min !== undefined && input.value < definition.min) ||
    (definition.max !== undefined && input.value > definition.max)
  ) {
    issue(
      issues,
      "invalid_value",
      `${path}.value`,
      "Number is outside the safe range",
    );
    return false;
  }
  return issues.every((entry) => !entry.path.startsWith(path));
}

function modeKey(mode: Omit<ThemeTokenMode, "tokens">): string {
  return [mode.theme, mode.contrast, mode.density, mode.platform].join("/");
}

export function validateThemeTokenDocument(input: unknown): ConformanceReport<{
  readonly document: ThemeTokenDocument;
  readonly modes: readonly ResolvedThemeMode[];
}> {
  const issues: ConformanceIssue[] = [];
  if (!record(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "invalid_type",
          path: "$",
          message: "Expected a token document object",
        },
      ],
    };
  }
  rejectUnknownFields(input, DOCUMENT_FIELDS, "$", issues);
  if (input.schemaVersion !== THEME_SCHEMA_VERSION) {
    issue(
      issues,
      "invalid_value",
      "$.schemaVersion",
      "Only schemaVersion 1 is supported",
    );
  }
  skinIdValue(input.skinId, "$.skinId", issues);
  if (!Array.isArray(input.modes) || input.modes.length === 0) {
    issue(
      issues,
      "invalid_type",
      "$.modes",
      "Expected at least one token mode",
    );
    return { valid: false, issues };
  }

  const resolvedModes: ResolvedThemeMode[] = [];
  const seenModes = new Set<string>();
  for (const [index, candidate] of input.modes.entries()) {
    const path = `$.modes[${index}]`;
    if (!record(candidate)) {
      issue(issues, "invalid_type", path, "Expected a mode object");
      continue;
    }
    rejectUnknownFields(candidate, MODE_FIELDS, path, issues);
    const themeValid = allowedArray(
      [candidate.theme],
      THEME_MODES,
      `${path}.theme`,
      issues,
    );
    const contrastValid = allowedArray(
      [candidate.contrast],
      CONTRAST_MODES,
      `${path}.contrast`,
      issues,
    );
    const densityValid = allowedArray(
      [candidate.density],
      DENSITIES,
      `${path}.density`,
      issues,
    );
    const platformValid = allowedArray(
      [candidate.platform],
      PLATFORMS,
      `${path}.platform`,
      issues,
    );
    if (!record(candidate.tokens)) {
      issue(
        issues,
        "invalid_type",
        `${path}.tokens`,
        "Expected a token object",
      );
      continue;
    }

    const resolvedTokens: Record<string, ThemeTokenValue> = {};
    const fallbackTokens: string[] = [];
    for (const name of Object.keys(candidate.tokens)) {
      if (!Object.hasOwn(SEMANTIC_TOKEN_REGISTRY, name)) {
        issue(
          issues,
          "unknown_token",
          `${path}.tokens.${name}`,
          `Unknown token: ${name}`,
        );
      }
    }
    for (const name of REQUIRED_SEMANTIC_TOKENS) {
      if (!Object.hasOwn(candidate.tokens, name)) {
        issue(
          issues,
          "missing_required_token",
          `${path}.tokens.${name}`,
          `Required token is missing: ${name}`,
        );
      } else {
        const value = candidate.tokens[name];
        if (validateTokenValue(value, name, `${path}.tokens.${name}`, issues)) {
          resolvedTokens[name] = value;
        }
      }
    }
    for (const name of OPTIONAL_SEMANTIC_TOKENS) {
      if (!Object.hasOwn(candidate.tokens, name)) {
        resolvedTokens[name] = SAFE_FALLBACK_TOKENS[name];
        fallbackTokens.push(name);
      } else {
        const value = candidate.tokens[name];
        if (validateTokenValue(value, name, `${path}.tokens.${name}`, issues)) {
          resolvedTokens[name] = value;
        }
      }
    }

    if (themeValid && contrastValid && densityValid && platformValid) {
      const mode = {
        theme: candidate.theme as ThemeMode,
        contrast: candidate.contrast as ContrastMode,
        density: candidate.density as DensityMode,
        platform: candidate.platform as PlatformCapability,
      };
      const key = modeKey(mode);
      if (seenModes.has(key)) {
        issue(issues, "duplicate_mode", path, `Duplicate token mode: ${key}`);
      }
      seenModes.add(key);
      resolvedModes.push({ ...mode, tokens: resolvedTokens, fallbackTokens });
    }
  }

  if (issues.length > 0) return { valid: false, issues };
  return {
    valid: true,
    issues,
    value: {
      document: input as unknown as ThemeTokenDocument,
      modes: resolvedModes,
    },
  };
}

function expectedModeKeys(manifest: SkinManifest): Set<string> {
  const keys = new Set<string>();
  for (const theme of manifest.modes) {
    for (const contrast of manifest.capabilities.contrastModes) {
      for (const density of manifest.capabilities.densities) {
        for (const platform of manifest.capabilities.platforms) {
          keys.add(modeKey({ theme, contrast, density, platform }));
        }
      }
    }
  }
  return keys;
}

export function validateSkinPackage(
  input: unknown,
): ConformanceReport<ValidatedSkinPackage> {
  const issues: ConformanceIssue[] = [];
  if (!record(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "invalid_type",
          path: "$",
          message: "Expected a skin package object",
        },
      ],
    };
  }
  rejectUnknownFields(input, PACKAGE_FIELDS, "$", issues);
  const manifestReport = validateSkinManifest(input.manifest);
  for (const manifestIssue of manifestReport.issues) {
    issues.push({
      ...manifestIssue,
      path: `$.manifest${manifestIssue.path.slice(1)}`,
    });
  }
  if (!record(input.tokenDocuments)) {
    issue(
      issues,
      "invalid_type",
      "$.tokenDocuments",
      "Expected a token document map",
    );
  }
  if (!manifestReport.valid || manifestReport.value === undefined) {
    return { valid: false, issues };
  }
  if (!record(input.tokenDocuments)) return { valid: false, issues };
  const manifest = manifestReport.value;
  const tokenDocuments = input.tokenDocuments;
  const expectedFiles = new Set<string>(Object.values(manifest.tokens));
  for (const path of Object.keys(tokenDocuments)) {
    if (!expectedFiles.has(path)) {
      issue(
        issues,
        "unknown_document",
        `$.tokenDocuments.${path}`,
        "Unreferenced token document",
      );
    }
  }

  const documents: Record<string, ThemeTokenDocument> = {};
  const modes: ResolvedThemeMode[] = [];
  const seenModes = new Set<string>();
  const fallbackTokens = new Set<string>();
  for (const path of expectedFiles) {
    const documentInput = tokenDocuments[path];
    if (documentInput === undefined) {
      issue(
        issues,
        "missing_document",
        `$.tokenDocuments.${path}`,
        "Referenced token document is missing",
      );
      continue;
    }
    const report = validateThemeTokenDocument(documentInput);
    if (!report.valid || report.value === undefined) {
      for (const documentIssue of report.issues) {
        issues.push({
          ...documentIssue,
          path: `$.tokenDocuments.${path}${documentIssue.path.slice(1)}`,
        });
      }
      continue;
    }
    const { document: tokenDocument, modes: documentModes } = report.value;
    documents[path] = tokenDocument;
    if (tokenDocument.skinId !== manifest.id) {
      issue(
        issues,
        "manifest_mismatch",
        `$.tokenDocuments.${path}.skinId`,
        "Token document skinId does not match the manifest",
      );
    }
    for (const mode of documentModes) {
      const key = modeKey(mode);
      if (seenModes.has(key)) {
        issue(
          issues,
          "duplicate_mode",
          `$.tokenDocuments.${path}`,
          `Duplicate token mode: ${key}`,
        );
      }
      seenModes.add(key);
      modes.push(mode);
      for (const token of mode.fallbackTokens) fallbackTokens.add(token);

      const isLightFile = path === manifest.tokens.light;
      const isDarkFile = path === manifest.tokens.dark;
      const isContrastFile = path === manifest.tokens.contrast;
      const matchesFileRole =
        (isLightFile && mode.theme === "light" && mode.contrast === "normal") ||
        (isDarkFile && mode.theme === "dark" && mode.contrast === "normal") ||
        (isContrastFile && mode.contrast === "high");
      if (!matchesFileRole) {
        issue(
          issues,
          "manifest_mismatch",
          `$.tokenDocuments.${path}`,
          "Token mode does not match its manifest file role",
        );
      }
    }
  }

  const expectedModes = expectedModeKeys(manifest);
  for (const key of expectedModes) {
    if (!seenModes.has(key)) {
      issue(
        issues,
        "missing_mode",
        "$.tokenDocuments",
        `Required mode is missing: ${key}`,
      );
    }
  }
  for (const key of seenModes) {
    if (!expectedModes.has(key)) {
      issue(
        issues,
        "unsupported_capability",
        "$.tokenDocuments",
        `Mode was not declared by the manifest: ${key}`,
      );
    }
  }

  if (issues.length > 0) return { valid: false, issues };
  return {
    valid: true,
    issues,
    value: {
      manifest,
      documents,
      modes,
      fallbackTokens: [...fallbackTokens].sort(),
    },
  };
}

export function assertValidSkinPackage(input: unknown): ValidatedSkinPackage {
  const report = validateSkinPackage(input);
  if (!report.valid || report.value === undefined) {
    const detail = report.issues
      .map((entry) => `${entry.path} [${entry.code}] ${entry.message}`)
      .join("\n");
    throw new Error(`Skin package failed closed:\n${detail}`);
  }
  return report.value;
}
