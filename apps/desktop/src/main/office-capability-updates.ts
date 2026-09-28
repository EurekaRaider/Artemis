import { gt, rcompare, satisfies, valid } from "semver";
import {
  capabilityPackManifestSchema,
  type CapabilityPackManifest,
  type CapabilityPackStatus,
} from "@artemis/protocol";
import { verifyCapabilityManifest } from "./capability-pack-service.js";

export interface OfficeRuntimeCatalog {
  schemaVersion: 1;
  publicKeys: Record<string, string>;
  manifests: CapabilityPackManifest[];
  /** Trusted host configuration; remote catalogs cannot change this URL or keys. */
  updateUrl?: string;
}

interface UpdateOptions {
  hostVersion: string;
  platform: string;
  arch: string;
  fetch?: typeof fetch;
}

export class OfficeCapabilityUpdates {
  private manifests: CapabilityPackManifest[];
  private state: NonNullable<CapabilityPackStatus["updateCheck"]> = "idle";
  private error: string | undefined;
  private pending: Promise<void> | undefined;

  constructor(
    private readonly catalog: OfficeRuntimeCatalog,
    private readonly options: UpdateOptions,
  ) {
    if (catalog.updateUrl) {
      const url = new URL(catalog.updateUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw new Error("Office update source must be an HTTPS URL");
    }
    this.manifests = this.verified(catalog.manifests);
  }

  private verified(values: unknown[]): CapabilityPackManifest[] {
    return values.flatMap((value) => {
      const manifest = capabilityPackManifestSchema.parse(value);
      if (!valid(manifest.version))
        throw new Error("Invalid Office release version");
      if (
        manifest.platform !== this.options.platform ||
        manifest.arch !== this.options.arch ||
        !satisfies(this.options.hostVersion, manifest.hostRange)
      )
        return [];
      return [
        verifyCapabilityManifest(manifest, {
          ...this.options,
          publicKeys: this.catalog.publicKeys,
        }),
      ];
    });
  }

  available(): CapabilityPackManifest | undefined {
    return [...this.manifests].sort((a, b) =>
      rcompare(a.version, b.version),
    )[0];
  }

  status(
    installedVersion?: string,
  ): Pick<
    CapabilityPackStatus,
    | "availableVersion"
    | "updateVersion"
    | "canCheckUpdates"
    | "updateCheck"
    | "updateError"
  > {
    const available = this.available();
    return {
      ...(available ? { availableVersion: available.version } : {}),
      ...(available &&
      installedVersion &&
      gt(available.version, installedVersion)
        ? { updateVersion: available.version }
        : {}),
      canCheckUpdates: Boolean(this.catalog.updateUrl),
      updateCheck: this.state,
      ...(this.error ? { updateError: this.error } : {}),
    };
  }

  check(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.catalog.updateUrl) return Promise.resolve();
    this.state = "checking";
    this.error = undefined;
    this.pending = this.refresh(this.catalog.updateUrl)
      .then(() => {
        this.state = "checked";
      })
      .catch((error: unknown) => {
        this.state = "error";
        this.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async refresh(url: string): Promise<void> {
    const response = await (this.options.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
      headers: { Accept: "application/json" },
    });
    if (
      !response.ok ||
      !response.body ||
      (response.url && new URL(response.url).protocol !== "https:")
    )
      throw new Error(`Office update check failed: ${response.status}`);
    const limit = 16 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit)
      throw new Error("Office update catalog is too large");
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > limit) throw new Error("Office update catalog is too large");
      chunks.push(Buffer.from(chunk));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      !data ||
      data.schemaVersion !== 1 ||
      !Array.isArray(data.manifests) ||
      data.manifests.length > 32
    )
      throw new Error("Invalid Office update catalog");
    // Verify all candidates before changing the last known good catalog.
    const next = this.verified(data.manifests);
    const versions = new Map(
      this.manifests.map((manifest) => [manifest.version, manifest]),
    );
    for (const manifest of next) {
      const previous = versions.get(manifest.version);
      if (previous && previous.archive.sha256 !== manifest.archive.sha256)
        throw new Error(
          "An immutable capability version cannot be republished",
        );
      versions.set(manifest.version, manifest);
    }
    this.manifests = [...versions.values()];
  }
}
