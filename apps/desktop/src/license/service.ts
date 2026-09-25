import { randomBytes } from "node:crypto";
import { decodeLicense, type SignedLicense, type TrustKeys } from "./codec.js";

export type LicenseState =
  | "unlicensed"
  | "valid"
  | "expired"
  | "not_yet_valid"
  | "invalid_license"
  | "device_mismatch"
  | "clock_error"
  | "storage_error";
export interface LicenseStatus {
  state: LicenseState;
  device: string;
  expiresAt?: number;
}
export interface LicenseRecord {
  version: 1;
  token?: string;
  highWater: number;
  challenge?: string;
  interrupted: boolean;
}
export interface LicenseStorage {
  read(): LicenseRecord | undefined;
  write(record: LicenseRecord): void;
}

export class LicenseService {
  private record: LicenseRecord = {
    version: 1,
    highWater: 0,
    interrupted: false,
  };
  private license?: SignedLicense;
  private failure: LicenseState | undefined;
  private anchorWall: number;
  private anchorMono: number;
  suppressResume: boolean;

  constructor(
    readonly device: string,
    private keys: TrustKeys,
    private storage: LicenseStorage,
    private wall = Date.now,
    private monotonic = () => performance.now(),
  ) {
    this.anchorWall = wall();
    this.anchorMono = monotonic();
    try {
      const record = storage.read();
      if (record) {
        if (
          record.version !== 1 ||
          !Number.isSafeInteger(record.highWater) ||
          record.highWater < 0 ||
          typeof record.interrupted !== "boolean" ||
          (record.challenge !== undefined &&
            !/^[a-f0-9]{64}$/.test(record.challenge))
        )
          throw new Error("storage_error");
        this.record = record;
        if (record.token) {
          const license = decodeLicense(record.token, keys, device);
          if (license.kind !== "license") throw new Error("invalid_license");
          this.license = license;
        }
      }
    } catch (error) {
      this.failure =
        error instanceof Error &&
        (error.message === "device_mismatch" ||
          error.message === "invalid_license")
          ? error.message
          : "storage_error";
    }
    this.suppressResume =
      this.record.interrupted || this.status().state !== "valid";
  }

  private effectiveTime(): number {
    return Math.max(
      this.wall(),
      this.record.highWater,
      this.anchorWall + Math.max(0, this.monotonic() - this.anchorMono),
    );
  }

  status(): LicenseStatus {
    let state: LicenseState = this.failure ?? "unlicensed";
    if (!this.failure && this.license) {
      const now = this.effectiveTime();
      state =
        this.wall() + 300_000 <
        Math.max(
          this.record.highWater,
          this.anchorWall + Math.max(0, this.monotonic() - this.anchorMono),
        )
          ? "clock_error"
          : now < this.license.notBefore
            ? "not_yet_valid"
            : now >= this.license.expiresAt
              ? "expired"
              : "valid";
    }
    return {
      state,
      device: this.device,
      ...(this.license ? { expiresAt: this.license.expiresAt } : {}),
    };
  }

  assertValid(): void {
    const status = this.status();
    if (status.state !== "valid")
      throw new Error(`LICENSE_REQUIRED:${status.state}`);
  }

  private save(next: LicenseRecord): boolean {
    try {
      this.storage.write(next);
      this.record = next;
      return true;
    } catch {
      this.failure = "storage_error";
      return false;
    }
  }

  checkpoint(): LicenseStatus {
    if (!this.failure && this.license)
      this.save({
        ...this.record,
        highWater: Math.floor(this.effectiveTime()),
      });
    return this.status();
  }

  activate(token: unknown): LicenseStatus {
    const license = decodeLicense(token, this.keys, this.device);
    if (license.kind !== "license") throw new Error("invalid_license");
    if (this.failure === "storage_error") return this.status();
    if (
      this.save({
        ...this.record,
        token: (token as string).trim(),
        highWater: Math.floor(this.effectiveTime()),
      })
    ) {
      this.license = license;
      this.failure = undefined;
    }
    return this.status();
  }

  interrupt(): void {
    this.suppressResume = true;
    this.save({
      ...this.record,
      interrupted: true,
      highWater: Math.floor(this.effectiveTime()),
    });
  }

  recoveryChallenge(): string {
    if (!this.record.challenge) {
      if (
        !this.save({
          ...this.record,
          challenge: randomBytes(32).toString("hex"),
        })
      )
        throw new Error("storage_error");
    }
    return this.record.challenge!;
  }

  recover(token: unknown): LicenseStatus {
    const recovery = decodeLicense(token, this.keys, this.device);
    if (
      recovery.kind !== "recovery" ||
      !this.record.challenge ||
      recovery.challenge !== this.record.challenge ||
      this.wall() < recovery.notBefore ||
      this.wall() >= recovery.expiresAt
    )
      throw new Error("invalid_recovery");
    const { challenge: _challenge, ...record } = this.record;
    if (this.save({ ...record, highWater: recovery.baseline! })) {
      this.failure = undefined;
      this.anchorWall = Math.max(this.wall(), recovery.baseline!);
      this.anchorMono = this.monotonic();
    }
    return this.status();
  }
}
