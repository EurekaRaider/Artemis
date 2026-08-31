import { describe, expect, it } from "vitest";

import {
  OPTIONAL_SEMANTIC_TOKENS,
  REQUIRED_SEMANTIC_TOKENS,
  SAFE_FALLBACK_TOKENS,
  assertValidSkinPackage,
  isUiContractCompatible,
  skinIntegritySchema,
  themeManifestSchema,
  themeTokenDocumentSchema,
  validateSkinIntegrity,
  validateSkinManifest,
  validateSkinPackage,
  validateThemeTokenDocument,
  type SkinIntegrity,
  type SkinManifest,
  type ThemeTokenDocument,
} from "../src/index.js";

const manifest = {
  schemaVersion: 1,
  id: "com.example.test-skin",
  name: "Test Skin",
  version: "1.0.0",
  uiContract: ">=1 <2",
  modes: ["light", "dark"],
  tokens: {
    light: "tokens.light.json",
    dark: "tokens.dark.json",
  },
  capabilities: {
    contrastModes: ["normal"],
    densities: ["comfortable"],
    platforms: ["universal"],
  },
} as const satisfies SkinManifest;

function requiredTokens() {
  return Object.fromEntries(
    REQUIRED_SEMANTIC_TOKENS.map((name) => [name, SAFE_FALLBACK_TOKENS[name]]),
  );
}

function document(theme: "light" | "dark"): ThemeTokenDocument {
  return {
    schemaVersion: 1,
    skinId: manifest.id,
    modes: [
      {
        theme,
        contrast: "normal",
        density: "comfortable",
        platform: "universal",
        tokens: requiredTokens(),
      },
    ],
  };
}

function validPackage() {
  return {
    manifest,
    tokenDocuments: {
      "tokens.light.json": document("light"),
      "tokens.dark.json": document("dark"),
    },
  };
}

function validIntegrity(): SkinIntegrity {
  const hash = "0".repeat(64);
  return {
    algorithm: "sha256",
    files: {
      "manifest.json": hash,
      "tokens.light.json": hash,
      "tokens.dark.json": hash,
    },
  };
}

describe("theme manifest v1", () => {
  it("accepts the exact .artemis-skin data contract", () => {
    expect(validateSkinManifest(manifest)).toEqual({
      valid: true,
      issues: [],
      value: manifest,
    });
    expect(isUiContractCompatible(">=1 <2")).toBe(true);
  });

  it("fails closed for unknown fields, unsafe filenames, and versions", () => {
    const unknown = validateSkinManifest({ ...manifest, css: "body{}" });
    expect(unknown.valid).toBe(false);
    expect(unknown.issues.map((entry) => entry.code)).toContain(
      "unknown_field",
    );

    const pathTraversal = validateSkinManifest({
      ...manifest,
      tokens: { ...manifest.tokens, light: "../../desktop.css" },
    });
    expect(pathTraversal.valid).toBe(false);
    expect(pathTraversal.issues.map((entry) => entry.code)).toContain(
      "invalid_value",
    );

    const incompatible = validateSkinManifest({
      ...manifest,
      uiContract: ">=2 <3",
    });
    expect(incompatible.valid).toBe(false);
    expect(incompatible.issues.map((entry) => entry.code)).toContain(
      "incompatible_ui_contract",
    );
    expect(isUiContractCompatible(">=2 <3")).toBe(false);
    expect(validateSkinManifest({ ...manifest, version: "latest" }).valid).toBe(
      false,
    );
  });

  it("requires a safe multi-label reverse-DNS skin ID", () => {
    for (const id of [
      "artemis",
      "com/artemis/default",
      "com..artemis",
      "com.artemis.\ninvalid",
    ]) {
      expect(validateSkinManifest({ ...manifest, id }).valid).toBe(false);
    }
  });

  it("rejects inherited manifest fields", () => {
    const inheritedManifest = Object.create(manifest) as unknown;
    const report = validateSkinManifest(inheritedManifest);
    expect(report.valid).toBe(false);
    expect(report.issues[0]?.code).toBe("invalid_type");
  });
});

describe("semantic token documents", () => {
  it("resolves optional omissions only through registered safe fallbacks", () => {
    const report = validateThemeTokenDocument(document("light"));
    expect(report.valid).toBe(true);
    expect(report.value?.modes[0]?.fallbackTokens).toEqual(
      OPTIONAL_SEMANTIC_TOKENS,
    );
    for (const name of OPTIONAL_SEMANTIC_TOKENS) {
      expect(report.value?.modes[0]?.tokens[name]).toEqual(
        SAFE_FALLBACK_TOKENS[name],
      );
    }
  });

  it("rejects unknown/prototype token names and missing required tokens", () => {
    const tokens = requiredTokens();
    delete tokens[REQUIRED_SEMANTIC_TOKENS[0]!];
    tokens["color.injected"] = { kind: "color", value: "#ffffff" };
    tokens.toString = { kind: "color", value: "#ffffff" };
    tokens.constructor = { kind: "color", value: "#ffffff" };
    Object.defineProperty(tokens, "__proto__", {
      enumerable: true,
      value: { kind: "color", value: "#ffffff" },
    });
    const candidate = document("light");
    const report = validateThemeTokenDocument({
      ...candidate,
      modes: [{ ...candidate.modes[0], tokens }],
    });
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["missing_required_token", "unknown_token"]),
    );
  });

  it("rejects required token and mode fields inherited through prototypes", () => {
    const candidate = document("light");
    const inheritedTokens = Object.create(requiredTokens()) as unknown;
    const inheritedTokenReport = validateThemeTokenDocument({
      ...candidate,
      modes: [{ ...candidate.modes[0], tokens: inheritedTokens }],
    });
    expect(inheritedTokenReport.valid).toBe(false);
    expect(inheritedTokenReport.issues.map((entry) => entry.code)).toContain(
      "invalid_type",
    );

    const inheritedMode = Object.create(candidate.modes[0]) as unknown;
    const inheritedModeReport = validateThemeTokenDocument({
      ...candidate,
      modes: [inheritedMode],
    });
    expect(inheritedModeReport.valid).toBe(false);
    expect(inheritedModeReport.issues[0]?.code).toBe("invalid_type");
  });

  it("rejects CSS injection strings, out-of-range numbers, and token fields", () => {
    const tokens = requiredTokens();
    tokens["color.canvas"] = { kind: "color", value: "url(https://invalid)" };
    tokens["space.1"] = { kind: "length", value: 999, unit: "px" };
    tokens["shadow.surface"] = {
      kind: "shadow",
      value: "soft",
      selector: "body",
    };
    const candidate = document("light");
    const report = validateThemeTokenDocument({
      ...candidate,
      modes: [{ ...candidate.modes[0], tokens }],
    });
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["invalid_value", "unknown_field"]),
    );
  });
});

describe("skin integrity", () => {
  it("accepts sha256 hashes for exactly the manifest-declared data files", () => {
    expect(validateSkinIntegrity(validIntegrity(), manifest)).toEqual({
      valid: true,
      issues: [],
      value: validIntegrity(),
    });
  });

  it("rejects missing, unknown, inherited, and malformed integrity entries", () => {
    const missing = validIntegrity();
    delete (missing.files as { "tokens.dark.json"?: string })[
      "tokens.dark.json"
    ];
    expect(
      validateSkinIntegrity(missing, manifest).issues.map(
        (entry) => entry.code,
      ),
    ).toContain("missing_integrity_file");

    const unknown = {
      ...validIntegrity(),
      files: { ...validIntegrity().files, "theme.css": "0".repeat(64) },
    };
    expect(
      validateSkinIntegrity(unknown, manifest).issues.map(
        (entry) => entry.code,
      ),
    ).toContain("unknown_integrity_file");

    const malformed = validIntegrity();
    (malformed.files as { "manifest.json": string })["manifest.json"] =
      "A".repeat(64);
    expect(
      validateSkinIntegrity(malformed, manifest).issues.map(
        (entry) => entry.code,
      ),
    ).toContain("invalid_hash");

    const unknownField = {
      ...validIntegrity(),
      signature: "not-part-of-skin-v1",
    };
    expect(
      validateSkinIntegrity(unknownField, manifest).issues.map(
        (entry) => entry.code,
      ),
    ).toContain("unknown_field");

    const contrastManifest = {
      ...manifest,
      tokens: {
        ...manifest.tokens,
        contrast: "tokens.contrast.json",
      },
      capabilities: {
        ...manifest.capabilities,
        contrastModes: ["normal", "high"],
      },
    } as const satisfies SkinManifest;
    expect(
      validateSkinIntegrity(validIntegrity(), contrastManifest).issues.map(
        (entry) => entry.code,
      ),
    ).toContain("missing_integrity_file");

    const inheritedFiles = Object.create(validIntegrity().files) as unknown;
    expect(
      validateSkinIntegrity(
        { algorithm: "sha256", files: inheritedFiles },
        manifest,
      ).valid,
    ).toBe(false);
  });
});

describe("skin package conformance", () => {
  it("accepts a complete package and reports optional fallbacks", () => {
    const report = validateSkinPackage(validPackage());
    expect(report.valid).toBe(true);
    expect(report.value?.modes).toHaveLength(2);
    expect(report.value?.fallbackTokens).toEqual(
      [...OPTIONAL_SEMANTIC_TOKENS].sort(),
    );
    expect(() => assertValidSkinPackage(validPackage())).not.toThrow();
  });

  it("fails closed when a document or declared mode is missing", () => {
    const candidate = validPackage();
    delete candidate.tokenDocuments["tokens.dark.json"];
    const report = validateSkinPackage(candidate);
    expect(report.valid).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["missing_document", "missing_mode"]),
    );
    expect(() => assertValidSkinPackage(candidate)).toThrow("failed closed");
  });

  it("fails closed for malformed package envelopes without throwing", () => {
    expect(validateSkinPackage(null).issues[0]?.code).toBe("invalid_type");
    expect(
      validateSkinPackage({
        ...validPackage(),
        css: "body{}",
      }).issues.map((entry) => entry.code),
    ).toContain("unknown_field");
    expect(
      validateSkinPackage({ manifest, tokenDocuments: null }).issues[0]?.code,
    ).toBe("invalid_type");
  });

  it("publishes strict JSON Schema objects for all three artifacts", () => {
    expect(themeManifestSchema.additionalProperties).toBe(false);
    expect(themeManifestSchema.properties.uiContract).toEqual({
      const: ">=1 <2",
    });
    expect(themeManifestSchema.properties.tokens.properties.light).toEqual({
      const: "tokens.light.json",
    });
    expect(themeTokenDocumentSchema.additionalProperties).toBe(false);
    expect(
      themeTokenDocumentSchema.properties.modes.items.properties.tokens
        .additionalProperties,
    ).toBe(false);
    expect(
      themeTokenDocumentSchema.properties.modes.items.properties.tokens
        .required,
    ).toEqual(REQUIRED_SEMANTIC_TOKENS);
    expect(skinIntegritySchema.additionalProperties).toBe(false);
    expect(skinIntegritySchema.properties.algorithm).toEqual({
      const: "sha256",
    });
    expect(skinIntegritySchema.properties.files.additionalProperties).toBe(
      false,
    );
  });
});
