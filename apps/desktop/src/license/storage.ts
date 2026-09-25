import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  readFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { LicenseRecord, LicenseStorage } from "./service.js";

interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export function protectedLicenseStorage(
  path: string,
  encryption: Encryption,
): LicenseStorage {
  function available() {
    if (!encryption.isEncryptionAvailable()) throw new Error("storage_error");
  }
  return {
    read() {
      available();
      let bytes: Buffer;
      try {
        bytes = readFileSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
      if (bytes.length > 65536) throw new Error("storage_error");
      return JSON.parse(encryption.decryptString(bytes)) as LicenseRecord;
    },
    write(record) {
      available();
      const bytes = encryption.encryptString(JSON.stringify(record));
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, path);
    },
  };
}
