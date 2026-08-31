import {
  REQUIRED_SEMANTIC_TOKENS,
  SEMANTIC_TOKEN_REGISTRY,
} from "./registry.js";

function valueSchema(
  definition: (typeof SEMANTIC_TOKEN_REGISTRY)[keyof typeof SEMANTIC_TOKEN_REGISTRY],
) {
  const base = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "value"],
  } as const;

  switch (definition.kind) {
    case "color":
      return {
        ...base,
        properties: {
          kind: { const: "color" },
          value: {
            type: "string",
            pattern: "^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$",
          },
        },
      };
    case "length":
      return {
        ...base,
        required: ["kind", "value", "unit"],
        properties: {
          kind: { const: "length" },
          value: {
            type: "number",
            minimum: definition.min,
            maximum: definition.max,
          },
          unit: { const: "px" },
        },
      };
    case "duration":
      return {
        ...base,
        required: ["kind", "value", "unit"],
        properties: {
          kind: { const: "duration" },
          value: {
            type: "number",
            minimum: definition.min,
            maximum: definition.max,
          },
          unit: { const: "ms" },
        },
      };
    case "fontFamily":
    case "easing":
    case "shadow":
    case "fontWeight":
      return {
        ...base,
        properties: {
          kind: { const: definition.kind },
          value: { enum: definition.allowedValues },
        },
      };
    case "opacity":
      return {
        ...base,
        properties: {
          kind: { const: "opacity" },
          value: {
            type: "number",
            minimum: definition.min,
            maximum: definition.max,
          },
        },
      };
  }
}

const tokenProperties = Object.fromEntries(
  Object.entries(SEMANTIC_TOKEN_REGISTRY).map(([name, definition]) => [
    name,
    valueSchema(definition),
  ]),
);
const skinIdSchema = {
  type: "string",
  maxLength: 128,
  pattern:
    "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$",
} as const;
const sha256Schema = {
  type: "string",
  pattern: "^[0-9a-f]{64}$",
} as const;

export const themeManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://artemis.local/schema/theme-manifest-v1.json",
  title: "Artemis Skin Manifest v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "id",
    "name",
    "version",
    "uiContract",
    "modes",
    "tokens",
    "capabilities",
  ],
  properties: {
    schemaVersion: { const: 1 },
    id: skinIdSchema,
    name: {
      type: "string",
      pattern: "^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$",
    },
    version: {
      type: "string",
      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$",
    },
    uiContract: { const: ">=1 <2" },
    modes: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
      items: { enum: ["light", "dark"] },
    },
    tokens: {
      type: "object",
      additionalProperties: false,
      required: ["light", "dark"],
      properties: {
        light: { const: "tokens.light.json" },
        dark: { const: "tokens.dark.json" },
        contrast: { const: "tokens.contrast.json" },
      },
    },
    capabilities: {
      type: "object",
      additionalProperties: false,
      required: ["contrastModes", "densities", "platforms"],
      properties: {
        contrastModes: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          items: { enum: ["normal", "high"] },
        },
        densities: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          items: { enum: ["comfortable", "compact"] },
        },
        platforms: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { enum: ["universal", "macos", "windows", "linux"] },
        },
      },
    },
  },
} as const;

export const themeTokenDocumentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://artemis.local/schema/theme-tokens-v1.json",
  title: "Artemis Semantic Token Document v1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "skinId", "modes"],
  properties: {
    schemaVersion: { const: 1 },
    skinId: skinIdSchema,
    modes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["theme", "contrast", "density", "platform", "tokens"],
        properties: {
          theme: { enum: ["light", "dark"] },
          contrast: { enum: ["normal", "high"] },
          density: { enum: ["comfortable", "compact"] },
          platform: { enum: ["universal", "macos", "windows", "linux"] },
          tokens: {
            type: "object",
            additionalProperties: false,
            required: REQUIRED_SEMANTIC_TOKENS,
            properties: tokenProperties,
          },
        },
      },
    },
  },
} as const;

export const skinIntegritySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://artemis.local/schema/skin-integrity-v1.json",
  title: "Artemis Skin Integrity v1",
  type: "object",
  additionalProperties: false,
  required: ["algorithm", "files"],
  properties: {
    algorithm: { const: "sha256" },
    files: {
      type: "object",
      additionalProperties: false,
      required: ["manifest.json", "tokens.light.json", "tokens.dark.json"],
      properties: {
        "manifest.json": sha256Schema,
        "tokens.light.json": sha256Schema,
        "tokens.dark.json": sha256Schema,
        "tokens.contrast.json": sha256Schema,
      },
    },
  },
} as const;
