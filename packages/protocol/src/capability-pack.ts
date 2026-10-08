import { z } from "zod";

export const capabilityPathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !/[\x00-\x1f:]/u.test(value) &&
      !value.startsWith("/") &&
      value
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            !/[. ]$/u.test(part) &&
            !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part),
        ),
    "Unsafe capability path",
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/u)
  .max(40);
export const capabilityDependencySchema = z
  .object({
    id: z.literal("office-core"),
    version,
    optional: z.literal(true),
  })
  .strict();
export type CapabilityDependency = z.infer<typeof capabilityDependencySchema>;

/** Pack namespace token; also the install directory name under capability-packs/. */
export const capabilityPackIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/u);

const capabilityFileSchema = z
  .object({
    path: capabilityPathSchema,
    sha256: digest,
    bytes: z.number().int().nonnegative().max(1_073_741_824),
    executable: z.boolean(),
  })
  .strict();
const capabilityFilesSchema = z.array(capabilityFileSchema).min(1).max(50_000);
const capabilitySignatureSchema = z
  .object({
    keyId: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/u),
    value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u),
  })
  .strict();

function checkSharedInventory(
  value: {
    files: Array<{ path: string; bytes: number }>;
    archive: { unpackedBytes: number };
  },
  ctx: z.RefinementCtx,
): void {
  const names = new Set<string>();
  let bytes = 0;
  for (const file of value.files) {
    const name = file.path.normalize("NFC").toLowerCase();
    if (names.has(name))
      ctx.addIssue({ code: "custom", message: "Duplicate capability path" });
    names.add(name);
    bytes += file.bytes;
  }
  if (bytes !== value.archive.unpackedBytes)
    ctx.addIssue({ code: "custom", message: "Unpacked size mismatch" });
}

const officeCapabilityPackManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal("office-core"),
    version,
    hostRange: z.string().min(1).max(100),
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    sourceDigest: digest,
    archive: z
      .object({
        url: z
          .string()
          .url()
          .refine((value) =>
            /^https:\/\/github\.com\/EurekaRaider\/Artemis(?:Release)?\/releases\/download\/office-runtime-v\d+\.\d+\.\d+\/[^/?#]+\.zip$/u.test(
              value,
            ),
          ),
        sha256: digest,
        downloadBytes: z.number().int().positive().max(1_073_741_824),
        unpackedBytes: z.number().int().positive().max(3_221_225_472),
      })
      .strict(),
    entrypoint: capabilityPathSchema,
    officeExecutable: capabilityPathSchema,
    files: capabilityFilesSchema,
    native: z
      .object({
        signer: z.string().min(1).max(200),
        notarization: z.enum(["accepted-stapled", "not-applicable"]),
        windows: z
          .array(
            z
              .object({
                path: capabilityPathSchema,
                signer: z
                  .string()
                  .regex(/^[A-Fa-f0-9]{40}$/u)
                  .nullable(),
              })
              .strict(),
          )
          .min(1)
          .max(50_000)
          .optional(),
      })
      .strict(),
    signature: capabilitySignatureSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    checkSharedInventory(value, ctx);
    for (const path of [value.entrypoint, value.officeExecutable])
      if (!value.files.some((file) => file.path === path && file.executable))
        ctx.addIssue({
          code: "custom",
          message: "Executable is not in signed inventory",
        });
    if (
      (value.platform === "darwin" &&
        (value.arch !== "arm64" ||
          value.native.notarization !== "accepted-stapled")) ||
      (value.platform === "win32" &&
        (value.arch !== "x64" ||
          value.native.notarization !== "not-applicable"))
    )
      ctx.addIssue({ code: "custom", message: "Unsupported native target" });
    if (!value.archive.url.includes(`/office-runtime-v${value.version}/`))
      ctx.addIssue({ code: "custom", message: "Release version mismatch" });
    if (value.native.windows) {
      const paths = value.native.windows.map((binary) => binary.path);
      if (
        value.platform !== "win32" ||
        new Set(paths).size !== paths.length ||
        [value.entrypoint, value.officeExecutable].some(
          (path) => !paths.includes(path),
        ) ||
        paths.some(
          (path) =>
            !value.files.some((file) => file.path === path && file.executable),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid Windows executable trust inventory",
        });
    }
  });

const legacyReleaseHost =
  "https://github.com/EurekaRaider/ArtemisRelease/releases/download/";

/** Preserve signed legacy manifests; only the archive transport moves repositories. */
export function capabilityArchiveDownloadUrl(url: string): string {
  return url.startsWith(legacyReleaseHost)
    ? softwareReleaseHost + url.slice(legacyReleaseHost.length)
    : url;
}

const softwareReleaseHost =
  "https://github.com/EurekaRaider/Artemis/releases/download/";

/**
 * Software-only packs (no native engine, e.g. plugin packages). Same trust
 * machinery — signed inventory, digest-pinned archive, semver host range —
 * but no executables to notarize. Archive URLs are pinned to a per-pack
 * release tag on the same release host as office-core.
 */
const softwareCapabilityPackManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: capabilityPackIdSchema.refine(
      (id) => !["office-core", "computer-use"].includes(id),
      {
        message: "Reserved capability pack id",
      },
    ),
    version,
    hostRange: z.string().min(1).max(100),
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    sourceDigest: digest,
    archive: z
      .object({
        url: z
          .string()
          .url()
          .refine(
            (value) =>
              value.startsWith(softwareReleaseHost) ||
              value.startsWith(legacyReleaseHost),
          ),
        sha256: digest,
        downloadBytes: z.number().int().positive().max(1_073_741_824),
        unpackedBytes: z.number().int().positive().max(3_221_225_472),
      })
      .strict(),
    files: capabilityFilesSchema,
    signature: capabilitySignatureSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    checkSharedInventory(value, ctx);
    if (!value.archive.url.includes(`/${value.id}-v${value.version}/`))
      ctx.addIssue({ code: "custom", message: "Release version mismatch" });
  });

export const computerUsePackManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal("computer-use"),
    version,
    hostRange: z.string().min(1).max(100),
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    minimumOS: z.enum(["11", "14"]),
    helperProtocol: z.literal(1),
    sourceDigest: digest,
    entrypoint: capabilityPathSchema,
    pluginRoot: capabilityPathSchema,
    archive: z
      .object({
        url: z
          .url()
          .refine((value) =>
            /^https:\/\/github\.com\/EurekaRaider\/Artemis\/releases\/download\/computer-use-v\d+\.\d+\.\d+\/[^/?#]+\.zip$/u.test(
              value,
            ),
          ),
        sha256: digest,
        downloadBytes: z.number().int().positive().max(134_217_728),
        unpackedBytes: z.number().int().positive().max(268_435_456),
      })
      .strict(),
    files: capabilityFilesSchema,
    native: z
      .object({
        signer: z.string().min(1).max(200).nullable(),
        notarization: z.enum(["accepted-stapled", "not-applicable"]),
      })
      .strict(),
    signature: capabilitySignatureSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    checkSharedInventory(value, ctx);
    if (
      !value.files.some(
        (file) => file.path === value.entrypoint && file.executable,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Executable is not in signed inventory",
      });
    if (
      !value.files.some(
        (file) =>
          file.path === value.pluginRoot + "/artemis.plugin.json" &&
          !file.executable,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Plugin manifest is not in signed inventory",
      });
    if (!value.archive.url.includes(`/computer-use-v${value.version}/`))
      ctx.addIssue({ code: "custom", message: "Release version mismatch" });
    if (
      value.platform === "darwin"
        ? value.arch !== "arm64" ||
          value.minimumOS !== "14" ||
          !value.native.signer ||
          value.native.notarization !== "accepted-stapled" ||
          value.entrypoint !==
            "ArtemisComputerUse.app/Contents/MacOS/artemis-computer-use"
        : value.arch !== "x64" ||
          value.minimumOS !== "11" ||
          value.native.notarization !== "not-applicable" ||
          value.entrypoint !== "artemis-computer-use.exe" ||
          (value.native.signer !== null &&
            !/^[A-Fa-f0-9]{40}$/u.test(value.native.signer))
    )
      ctx.addIssue({
        code: "custom",
        message: "Unsupported Computer Use native target",
      });
  });
export type ComputerUsePackManifest = z.infer<
  typeof computerUsePackManifestSchema
>;

export const capabilityPackManifestSchema = z.union([
  officeCapabilityPackManifestSchema,
  computerUsePackManifestSchema,
  softwareCapabilityPackManifestSchema,
]);
export type CapabilityPackManifest = z.infer<
  typeof capabilityPackManifestSchema
>;
export type OfficeCorePackManifest = z.infer<
  typeof officeCapabilityPackManifestSchema
>;
export type SoftwarePackManifest = z.infer<
  typeof softwareCapabilityPackManifestSchema
>;

export interface CapabilityPackStatus {
  /** Pack namespace, e.g. "office-core"; one service instance manages one pack. */
  id: string;
  availableVersion?: string;
  updateVersion?: string;
  canCheckUpdates?: boolean;
  updateCheck?: "idle" | "checking" | "checked" | "error";
  updateError?: string;
  activeVersion?: string;
  versions: Array<{
    version: string;
    bytes: number;
    active: boolean;
    inUse: boolean;
  }>;
  dependents: string[];
  phase: "idle" | "downloading" | "verifying" | "installing";
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

/** Deterministic signing bytes. The signature object itself is excluded by callers. */
export function canonicalCapabilityJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalCapabilityJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalCapabilityJson(item)}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
