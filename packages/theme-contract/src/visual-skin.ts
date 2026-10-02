import { SKIN_ICON_NAMES } from "./skin-icon-names.js";
import type {
  ConformanceIssue,
  ConformanceReport,
  SkinManifest,
  ValidatedSkinPackage,
} from "./types.js";
import {
  validateSkinManifest,
  validateSkinPackage,
  validateSkinIntegrity,
} from "./validate.js";

export const SKIN_RESOURCE_LIMITS = Object.freeze({
  json: 1_048_576,
  image: 10 * 1_048_576,
  imagePixels: 20_000_000,
  video: 50 * 1_048_576,
  videoWidth: 1920,
  videoHeight: 1080,
  videoSeconds: 60,
  font: 20 * 1_048_576,
});
export type SkinAssetKind = "image" | "video" | "font";
export interface SkinAsset {
  readonly path: string;
  readonly kind: SkinAssetKind;
}
export interface SkinBackground {
  readonly type: "none" | "image" | "video";
  readonly asset?: string;
  readonly poster?: string;
  readonly fit?: "cover" | "contain";
  readonly position?: readonly [number, number];
  readonly opacity?: number;
  readonly blur?: number;
  readonly scrim?: string;
}
export type SkinFontRole = "ui" | "conversation" | "code";
export interface SkinFont {
  readonly asset: string;
  readonly weight: 400 | 500 | 600 | 700;
  readonly style: "normal" | "italic";
}
export type SkinGeometry =
  | { readonly type: "path"; readonly d: string; readonly fill?: boolean }
  | {
      readonly type: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill?: boolean;
    }
  | {
      readonly type: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
      readonly fill?: boolean;
    }
  | {
      readonly type: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    };
export interface SkinIcons {
  readonly schemaVersion: 1;
  readonly icons: Readonly<Record<string, readonly SkinGeometry[]>>;
}
export interface SkinMotionPreset {
  readonly preset: "none" | "fade" | "slide" | "scale" | "pulse" | "float";
  readonly duration: number;
  readonly distance: number;
  readonly loop?: boolean;
}
export interface SkinMotion {
  readonly schemaVersion: 1;
  readonly targets: Readonly<
    Partial<Record<"background" | "surface" | "controls", SkinMotionPreset>>
  >;
}
export interface VisualSkinManifest extends Omit<
  SkinManifest,
  "schemaVersion"
> {
  readonly schemaVersion: 2;
  readonly assets: Readonly<Record<string, SkinAsset>>;
  readonly backgrounds: Readonly<Record<"light" | "dark", SkinBackground>>;
  readonly fonts?: Readonly<Partial<Record<SkinFontRole, readonly SkinFont[]>>>;
  readonly icons?: "icons.json";
  readonly motion?: "motion.json";
}
export type AnySkinManifest = SkinManifest | VisualSkinManifest;
export interface ValidatedVisualSkinPackage extends Omit<
  ValidatedSkinPackage,
  "manifest"
> {
  readonly manifest: AnySkinManifest;
  readonly icons?: SkinIcons;
  readonly motion?: SkinMotion;
}
export interface VisualSkinIntegrity {
  readonly schemaVersion: 2;
  readonly algorithm: "sha256";
  readonly files: Readonly<Record<string, string>>;
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
export function isSkinRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 240 &&
    /^[a-zA-Z0-9_./-]+$/u.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every((p) => p !== "" && p !== "." && p !== "..")
  );
}
const baseFields = [
  "id",
  "name",
  "version",
  "uiContract",
  "modes",
  "tokens",
  "capabilities",
] as const;
function baseManifest(input: Record<string, unknown>) {
  return Object.fromEntries([
    ["schemaVersion", 1],
    ...baseFields.map((k) => [k, input[k]]),
  ]);
}
function checkUnknown(
  input: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: ConformanceIssue[],
) {
  for (const k of Object.keys(input))
    if (!keys.includes(k))
      issues.push({
        code: "unknown_field",
        path: `${path}.${k}`,
        message: `Unknown field: ${k}`,
      });
}
function failure<T>(
  message: string,
  path = "$",
  code: ConformanceIssue["code"] = "invalid_value",
): ConformanceReport<T> {
  return { valid: false, issues: [{ code, path, message }] };
}
function result<T>(
  issues: ConformanceIssue[],
  input: unknown,
): ConformanceReport<T> {
  return issues.length
    ? { valid: false, issues }
    : { valid: true, issues, value: input as T };
}
function number(v: unknown, min: number, max: number) {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

export function validateVisualSkinManifest(
  input: unknown,
): ConformanceReport<AnySkinManifest> {
  if (!object(input) || input.schemaVersion !== 2)
    return validateSkinManifest(input);
  const issues = [...validateSkinManifest(baseManifest(input)).issues];
  checkUnknown(
    input,
    [
      "schemaVersion",
      ...baseFields,
      "assets",
      "backgrounds",
      "fonts",
      "icons",
      "motion",
    ],
    "$",
    issues,
  );
  const bad = (path: string, message: string) =>
    issues.push({ code: "invalid_value", path, message });
  const assets = input.assets;
  if (!object(assets) || Object.keys(assets).length > 128)
    bad("$.assets", "Expected at most 128 declared assets");
  const paths = new Set<string>();
  if (object(assets))
    for (const [id, a] of Object.entries(assets)) {
      if (!/^[a-z][a-z0-9-]{0,63}$/u.test(id) || !object(a)) {
        bad(`$.assets.${id}`, "Invalid asset");
        continue;
      }
      checkUnknown(a, ["path", "kind"], `$.assets.${id}`, issues);
      const extensions: Record<string, RegExp> = {
        image: /\.(png|jpe?g|webp)$/iu,
        video: /\.(mp4|webm)$/iu,
        font: /\.woff2$/iu,
      };
      if (
        !isSkinRelativePath(a.path) ||
        !a.path.startsWith("assets/") ||
        !extensions[String(a.kind)]?.test(a.path)
      )
        bad(`$.assets.${id}`, "Invalid asset kind or path");
      else {
        if (paths.has(a.path))
          bad(`$.assets.${id}.path`, "Asset paths must be unique");
        paths.add(a.path);
      }
    }
  const reference = (id: unknown, kind: SkinAssetKind) =>
    typeof id === "string" &&
    object(assets) &&
    object(assets[id]) &&
    assets[id].kind === kind;
  if (!object(input.backgrounds))
    bad("$.backgrounds", "Both light and dark backgrounds are required");
  else {
    checkUnknown(input.backgrounds, ["light", "dark"], "$.backgrounds", issues);
    for (const theme of ["light", "dark"]) {
      const b = input.backgrounds[theme],
        path = `$.backgrounds.${theme}`;
      if (!object(b)) {
        bad(path, "Expected background");
        continue;
      }
      checkUnknown(
        b,
        [
          "type",
          "asset",
          "poster",
          "fit",
          "position",
          "opacity",
          "blur",
          "scrim",
        ],
        path,
        issues,
      );
      if (!["none", "image", "video"].includes(String(b.type)))
        bad(path, "Unknown background type");
      if (
        b.type !== "none" &&
        !reference(b.asset, b.type === "video" ? "video" : "image")
      )
        bad(`${path}.asset`, "Missing resource or wrong kind");
      if (b.type === "video" && !reference(b.poster, "image"))
        bad(`${path}.poster`, "Video requires a static image poster");
      if (b.type !== "video" && b.poster !== undefined)
        bad(`${path}.poster`, "Only video can declare a poster");
      if (b.type === "none" && b.asset !== undefined)
        bad(`${path}.asset`, "Empty background cannot reference an asset");
      if (b.fit !== undefined && !["cover", "contain"].includes(String(b.fit)))
        bad(`${path}.fit`, "Invalid fit");
      if (
        b.position !== undefined &&
        (!Array.isArray(b.position) ||
          b.position.length !== 2 ||
          !b.position.every((v) => number(v, 0, 100)))
      )
        bad(`${path}.position`, "Position must contain two percentages");
      if (b.opacity !== undefined && !number(b.opacity, 0, 1))
        bad(`${path}.opacity`, "Opacity outside 0–1");
      if (b.blur !== undefined && !number(b.blur, 0, 24))
        bad(`${path}.blur`, "Blur outside 0–24px");
      if (
        b.scrim !== undefined &&
        (typeof b.scrim !== "string" ||
          !/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/iu.test(b.scrim))
      )
        bad(`${path}.scrim`, "Scrim must be a hex color");
    }
  }
  if (input.fonts !== undefined) {
    if (!object(input.fonts)) bad("$.fonts", "Expected font roles");
    else {
      checkUnknown(
        input.fonts,
        ["ui", "conversation", "code"],
        "$.fonts",
        issues,
      );
      for (const [role, fonts] of Object.entries(input.fonts)) {
        if (!Array.isArray(fonts) || fonts.length < 1 || fonts.length > 8) {
          bad(`$.fonts.${role}`, "Expected 1–8 font faces");
          continue;
        }
        const faces = new Set<string>();
        for (const f of fonts) {
          if (!object(f)) {
            bad(`$.fonts.${role}`, "Invalid font");
            continue;
          }
          checkUnknown(
            f,
            ["asset", "weight", "style"],
            `$.fonts.${role}`,
            issues,
          );
          if (
            !reference(f.asset, "font") ||
            ![400, 500, 600, 700].includes(Number(f.weight)) ||
            typeof f.weight !== "number" ||
            !["normal", "italic"].includes(String(f.style))
          )
            bad(`$.fonts.${role}`, "Invalid font face");
          const key = `${f.weight}/${f.style}`;
          if (faces.has(key)) bad(`$.fonts.${role}`, "Duplicate font face");
          faces.add(key);
        }
      }
    }
  }
  if (input.icons !== undefined && input.icons !== "icons.json")
    bad("$.icons", "Expected icons.json");
  if (input.motion !== undefined && input.motion !== "motion.json")
    bad("$.motion", "Expected motion.json");
  return result(issues, input);
}

export function validateSkinIcons(
  input: unknown,
): ConformanceReport<SkinIcons> {
  if (
    !object(input) ||
    input.schemaVersion !== 1 ||
    !object(input.icons) ||
    Object.keys(input.icons).length > 128
  )
    return failure("Invalid icon document");
  const issues: ConformanceIssue[] = [];
  checkUnknown(input, ["schemaVersion", "icons"], "$", issues);
  for (const [name, shapes] of Object.entries(input.icons)) {
    const path = `$.icons.${name}`;
    if (
      !(SKIN_ICON_NAMES as readonly string[]).includes(name) ||
      !Array.isArray(shapes) ||
      shapes.length < 1 ||
      shapes.length > 32
    ) {
      issues.push({
        code: "invalid_value",
        path,
        message: "Invalid icon name or shape count",
      });
      continue;
    }
    for (const shape of shapes) {
      if (!object(shape)) {
        issues.push({
          code: "invalid_type",
          path,
          message: "Expected geometry",
        });
        continue;
      }
      const fields: Record<string, string[]> = {
        path: ["d"],
        circle: ["cx", "cy", "r"],
        rect: ["x", "y", "width", "height", "rx"],
        line: ["x1", "y1", "x2", "y2"],
      };
      const geometry = fields[String(shape.type)];
      if (!geometry) {
        issues.push({
          code: "invalid_value",
          path,
          message: "Unknown geometry",
        });
        continue;
      }
      checkUnknown(
        shape,
        ["type", ...(shape.type === "line" ? [] : ["fill"]), ...geometry],
        path,
        issues,
      );
      if (shape.fill !== undefined && typeof shape.fill !== "boolean")
        issues.push({
          code: "invalid_value",
          path,
          message: "Fill must be boolean",
        });
      for (const key of geometry) {
        if (key === "rx" && shape.rx === undefined) continue;
        const v = shape[key];
        const valid =
          key === "d"
            ? typeof v === "string" &&
              v.length <= 8192 &&
              /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/u.test(v)
            : number(v, 0, 24);
        if (!valid)
          issues.push({
            code: "invalid_value",
            path: `${path}.${key}`,
            message: "Geometry outside the 24px coordinate contract",
          });
      }
    }
  }
  return result(issues, input);
}
export function validateSkinMotion(
  input: unknown,
): ConformanceReport<SkinMotion> {
  if (!object(input) || input.schemaVersion !== 1 || !object(input.targets))
    return failure("Invalid motion document");
  const issues: ConformanceIssue[] = [];
  checkUnknown(input, ["schemaVersion", "targets"], "$", issues);
  checkUnknown(
    input.targets,
    ["background", "surface", "controls"],
    "$.targets",
    issues,
  );
  for (const [target, m] of Object.entries(input.targets)) {
    if (!object(m)) {
      issues.push({
        code: "invalid_type",
        path: target,
        message: "Expected preset",
      });
      continue;
    }
    checkUnknown(
      m,
      ["preset", "duration", "distance", "loop"],
      `$.targets.${target}`,
      issues,
    );
    if (
      !["none", "fade", "slide", "scale", "pulse", "float"].includes(
        String(m.preset),
      ) ||
      !number(m.duration, 0, 500) ||
      !number(m.distance, 0, 12) ||
      (m.loop !== undefined && typeof m.loop !== "boolean") ||
      (m.loop === true && target !== "background")
    )
      issues.push({
        code: "invalid_value",
        path: target,
        message: "Motion exceeds host limits",
      });
  }
  return result(issues, input);
}
export function skinDeclaredFiles(manifest: AnySkinManifest): string[] {
  return [
    "manifest.json",
    ...Object.values(manifest.tokens),
    ...(manifest.schemaVersion === 2
      ? [
          ...Object.values(manifest.assets).map((a) => a.path),
          ...(manifest.icons ? [manifest.icons] : []),
          ...(manifest.motion ? [manifest.motion] : []),
        ]
      : []),
  ];
}
export function validateVisualSkinIntegrity(
  input: unknown,
  manifestInput: unknown,
): ConformanceReport<VisualSkinIntegrity | import("./types.js").SkinIntegrity> {
  const manifest = validateVisualSkinManifest(manifestInput);
  if (!manifest.valid || !manifest.value)
    return { valid: false, issues: manifest.issues };
  if (manifest.value.schemaVersion === 1)
    return validateSkinIntegrity(input, manifestInput);
  if (
    !object(input) ||
    input.schemaVersion !== 2 ||
    input.algorithm !== "sha256" ||
    !object(input.files)
  )
    return failure("Expected Skin v2 sha256 integrity");
  const issues: ConformanceIssue[] = [];
  checkUnknown(input, ["schemaVersion", "algorithm", "files"], "$", issues);
  const expected = new Set(skinDeclaredFiles(manifest.value));
  for (const [file, hash] of Object.entries(input.files)) {
    if (!expected.delete(file))
      issues.push({
        code: "unknown_integrity_file",
        path: file,
        message: "Undeclared file",
      });
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash))
      issues.push({
        code: "invalid_hash",
        path: file,
        message: "Invalid sha256 digest",
      });
  }
  for (const file of expected)
    issues.push({
      code: "missing_integrity_file",
      path: file,
      message: "Missing digest",
    });
  return result(issues, input);
}
export function validateVisualSkinPackage(
  input: unknown,
): ConformanceReport<ValidatedVisualSkinPackage> {
  if (
    !object(input) ||
    !object(input.manifest) ||
    input.manifest.schemaVersion !== 2
  )
    return validateSkinPackage(input);
  const manifest = validateVisualSkinManifest(input.manifest);
  if (!manifest.valid || !manifest.value)
    return { valid: false, issues: manifest.issues };
  const tokens = validateSkinPackage({
    manifest: baseManifest(input.manifest),
    tokenDocuments: input.tokenDocuments,
  });
  const issues = [...tokens.issues];
  checkUnknown(
    input,
    ["manifest", "tokenDocuments", "icons", "motion"],
    "$",
    issues,
  );
  const icons = input.manifest.icons
    ? validateSkinIcons(input.icons)
    : undefined;
  const motion = input.manifest.motion
    ? validateSkinMotion(input.motion)
    : undefined;
  if (icons) issues.push(...icons.issues);
  else if (input.icons !== undefined)
    issues.push({
      code: "unknown_document",
      path: "$.icons",
      message: "Undeclared icons",
    });
  if (motion) issues.push(...motion.issues);
  else if (input.motion !== undefined)
    issues.push({
      code: "unknown_document",
      path: "$.motion",
      message: "Undeclared motion",
    });
  if (issues.length || !tokens.value) return { valid: false, issues };
  return {
    valid: true,
    issues,
    value: {
      ...tokens.value,
      manifest: manifest.value,
      ...(icons?.value ? { icons: icons.value } : {}),
      ...(motion?.value ? { motion: motion.value } : {}),
    },
  };
}
