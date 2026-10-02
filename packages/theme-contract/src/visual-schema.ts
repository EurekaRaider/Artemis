import { themeManifestSchema } from "./schema.js";
import { SKIN_ICON_NAMES } from "./skin-icon-names.js";
const object = (
  properties: Record<string, unknown>,
  required: readonly string[] = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const number = (minimum: number, maximum: number) => ({
  type: "number",
  minimum,
  maximum,
});
const resourceId = { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" };
const path = {
  type: "string",
  maxLength: 240,
  pattern:
    "^assets/(?!\\.\\.?(?:/|$))(?!.*?/\\.\\.?(?:/|$))(?:[a-zA-Z0-9_.-]+/)*[a-zA-Z0-9_.-]+$",
};
const background = object(
  {
    type: { enum: ["none", "image", "video"] },
    asset: resourceId,
    poster: resourceId,
    fit: { enum: ["cover", "contain"] },
    position: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: number(0, 100),
    },
    opacity: number(0, 1),
    blur: number(0, 24),
    scrim: { type: "string", pattern: "^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$" },
  },
  ["type"],
);
const font = object({
  asset: resourceId,
  weight: { enum: [400, 500, 600, 700] },
  style: { enum: ["normal", "italic"] },
});
export const visualSkinManifestSchema = {
  ...themeManifestSchema,
  $id: "https://artemis.local/schema/theme-manifest-v2.json",
  title: "Artemis Visual Skin Manifest v2",
  required: [...themeManifestSchema.required, "assets", "backgrounds"],
  properties: {
    ...themeManifestSchema.properties,
    schemaVersion: { const: 2 },
    assets: {
      type: "object",
      maxProperties: 128,
      propertyNames: resourceId,
      additionalProperties: {
        ...object({ path, kind: { enum: ["image", "video", "font"] } }),
        allOf: [
          {
            if: { properties: { kind: { const: "image" } } },
            then: {
              properties: {
                path: {
                  pattern:
                    "\\.([pP][nN][gG]|[jJ][pP][eE]?[gG]|[wW][eE][bB][pP])$",
                },
              },
            },
          },
          {
            if: { properties: { kind: { const: "video" } } },
            then: {
              properties: {
                path: { pattern: "\\.([mM][pP]4|[wW][eE][bB][mM])$" },
              },
            },
          },
          {
            if: { properties: { kind: { const: "font" } } },
            then: {
              properties: { path: { pattern: "\\.[wW][oO][fF][fF]2$" } },
            },
          },
        ],
      },
    },
    backgrounds: object({
      light: {
        ...background,
        allOf: [
          {
            if: { properties: { type: { const: "image" } } },
            then: { required: ["asset"] },
          },
          {
            if: { properties: { type: { const: "video" } } },
            then: { required: ["asset", "poster"] },
          },
        ],
      },
      dark: {
        ...background,
        allOf: [
          {
            if: { properties: { type: { const: "image" } } },
            then: { required: ["asset"] },
          },
          {
            if: { properties: { type: { const: "video" } } },
            then: { required: ["asset", "poster"] },
          },
        ],
      },
    }),
    fonts: object(
      Object.fromEntries(
        ["ui", "conversation", "code"].map((role) => [
          role,
          { type: "array", minItems: 1, maxItems: 8, items: font },
        ]),
      ),
      [],
    ),
    icons: { const: "icons.json" },
    motion: { const: "motion.json" },
  },
};
const coordinate = number(0, 24),
  fill = { type: "boolean" };
export const skinIconsSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://artemis.local/schema/skin-icons-v1.json",
  ...object({
    schemaVersion: { const: 1 },
    icons: {
      type: "object",
      maxProperties: 128,
      propertyNames: { enum: SKIN_ICON_NAMES },
      additionalProperties: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: {
          oneOf: [
            object(
              {
                type: { const: "path" },
                d: {
                  type: "string",
                  maxLength: 8192,
                  pattern: "^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\\s-]+$",
                },
                fill,
              },
              ["type", "d"],
            ),
            object(
              {
                type: { const: "circle" },
                cx: coordinate,
                cy: coordinate,
                r: coordinate,
                fill,
              },
              ["type", "cx", "cy", "r"],
            ),
            object(
              {
                type: { const: "rect" },
                x: coordinate,
                y: coordinate,
                width: coordinate,
                height: coordinate,
                rx: coordinate,
                fill,
              },
              ["type", "x", "y", "width", "height"],
            ),
            object({
              type: { const: "line" },
              x1: coordinate,
              y1: coordinate,
              x2: coordinate,
              y2: coordinate,
            }),
          ],
        },
      },
    },
  }),
};
const motion = object(
  {
    preset: { enum: ["none", "fade", "slide", "scale", "pulse", "float"] },
    duration: number(0, 500),
    distance: number(0, 12),
    loop: { type: "boolean" },
  },
  ["preset", "duration", "distance"],
);
export const skinMotionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://artemis.local/schema/skin-motion-v1.json",
  ...object({
    schemaVersion: { const: 1 },
    targets: object(
      {
        background: motion,
        surface: {
          ...motion,
          properties: { ...motion.properties, loop: { const: false } },
        },
        controls: {
          ...motion,
          properties: { ...motion.properties, loop: { const: false } },
        },
      },
      [],
    ),
  }),
};
export const visualSkinIntegritySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://artemis.local/schema/skin-integrity-v2.json",
  ...object({
    schemaVersion: { const: 2 },
    algorithm: { const: "sha256" },
    files: {
      type: "object",
      minProperties: 3,
      maxProperties: 256,
      additionalProperties: { type: "string", pattern: "^[a-f0-9]{64}$" },
    },
  }),
};
