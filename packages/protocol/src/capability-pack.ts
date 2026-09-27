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

export const capabilityPackManifestSchema = z
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
            /^https:\/\/github\.com\/EurekaRaider\/ArtemisRelease\/releases\/download\/office-runtime-v\d+\.\d+\.\d+\/[^/?#]+\.zip$/u.test(
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
    files: z
      .array(
        z
          .object({
            path: capabilityPathSchema,
            sha256: digest,
            bytes: z.number().int().nonnegative().max(1_073_741_824),
            executable: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(50_000),
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
    signature: z
      .object({
        keyId: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/u),
        value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
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
export type CapabilityPackManifest = z.infer<
  typeof capabilityPackManifestSchema
>;

export interface CapabilityPackStatus {
  id: "office-core";
  availableVersion?: string;
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
